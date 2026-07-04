import JSZip from 'jszip';

/**
 * Represents a text node in the docx XML with its position in the flat text.
 */
interface TextNodeMapping {
  /** The <w:t> element */
  element: Element;
  /** Start index in the flat text */
  flatStart: number;
  /** End index in the flat text */
  flatEnd: number;
}

/**
 * Tracks the boundary between paragraphs in the flat text (newline positions).
 */
interface ParagraphBreak {
  flatIndex: number;
}

/**
 * Result of extracting text from a docx file.
 */
export interface DocxExtraction {
  /** The flat plain text extracted from the document */
  plainText: string;
  /** The parsed XML document */
  xmlDoc: Document;
  /** Mapping from flat text positions to XML <w:t> elements */
  textNodes: TextNodeMapping[];
  /** Positions of paragraph breaks in the flat text */
  paragraphBreaks: ParagraphBreak[];
  /** The JSZip instance for re-packaging */
  zip: JSZip;
  /** The path of the main document XML within the zip */
  documentXmlPath: string;
  /** All content XML paths (document, headers, footers) and their extractions */
  contentParts: ContentPartExtraction[];
}

interface ContentPartExtraction {
  path: string;
  xmlDoc: Document;
  textNodes: TextNodeMapping[];
  paragraphBreaks: ParagraphBreak[];
  flatTextStart: number; // offset in the combined plain text
  flatTextEnd: number;
}

const W_NS = 'http://schemas.openxmlformats.org/wordprocessingml/2006/main';

/**
 * Element local names (in the w: namespace) that carry document text.
 * - t: regular run text
 * - delText: text inside tracked deletions (w:del); still physically present in the file
 * - instrText: field instructions (e.g. HYPERLINK targets, MERGEFIELD sources)
 */
const TEXT_ELEMENT_NAMES = new Set(['t', 'delText', 'instrText']);

/**
 * Extract all text-bearing elements from an XML document, building a flat text
 * and position mapping.
 */
function extractTextFromXml(xmlDoc: Document): {
  plainText: string;
  textNodes: TextNodeMapping[];
  paragraphBreaks: ParagraphBreak[];
} {
  const textNodes: TextNodeMapping[] = [];
  const paragraphBreaks: ParagraphBreak[] = [];
  let flatText = '';

  const body = xmlDoc.getElementsByTagNameNS(W_NS, 'body')[0];
  if (!body) {
    // For headers/footers/footnotes/comments, process the root element's children
    const root = xmlDoc.documentElement;
    processParagraphs(root);
  } else {
    processParagraphs(body);
  }

  function processParagraphs(parent: Element) {
    const paragraphs = parent.getElementsByTagNameNS(W_NS, 'p');
    // Paragraphs can nest (text boxes hold w:p inside an outer w:p run), so the
    // same text element is reachable from more than one paragraph. Track visited
    // elements to map each one exactly once.
    const seen = new Set<Element>();
    for (let pi = 0; pi < paragraphs.length; pi++) {
      const para = paragraphs[pi];
      if (pi > 0) {
        paragraphBreaks.push({ flatIndex: flatText.length });
        flatText += '\n';
      }
      // Walk all descendants in document order so t/delText/instrText interleave correctly
      const descendants = para.getElementsByTagName('*');
      for (let di = 0; di < descendants.length; di++) {
        const el = descendants[di];
        if (el.namespaceURI !== W_NS || !TEXT_ELEMENT_NAMES.has(el.localName)) continue;
        if (seen.has(el)) continue;
        seen.add(el);
        const text = el.textContent ?? '';
        if (text.length > 0) {
          textNodes.push({
            element: el,
            flatStart: flatText.length,
            flatEnd: flatText.length + text.length,
          });
          flatText += text;
        }
      }
    }
  }

  return { plainText: flatText, textNodes, paragraphBreaks };
}

/**
 * Read a .docx file and extract its text content with position mapping.
 */
export async function readDocx(file: File): Promise<DocxExtraction> {
  const arrayBuffer = await file.arrayBuffer();
  const zip = await JSZip.loadAsync(arrayBuffer);

  // Find the main document XML path
  const documentXmlPath = 'word/document.xml';
  const docXmlFile = zip.file(documentXmlPath);
  if (!docXmlFile) {
    throw new Error('Invalid .docx file: missing word/document.xml');
  }

  const docXmlStr = await docXmlFile.async('string');
  const parser = new DOMParser();
  const xmlDoc = parser.parseFromString(docXmlStr, 'application/xml');

  const parseError = xmlDoc.querySelector('parsererror');
  if (parseError) {
    throw new Error('Failed to parse document XML');
  }

  const { plainText, textNodes, paragraphBreaks } = extractTextFromXml(xmlDoc);

  // Also process headers and footers
  const contentParts: ContentPartExtraction[] = [];
  let combinedText = plainText;

  // Add main document as first content part
  contentParts.push({
    path: documentXmlPath,
    xmlDoc,
    textNodes,
    paragraphBreaks,
    flatTextStart: 0,
    flatTextEnd: plainText.length,
  });

  // Find all other text-bearing parts: headers, footers, footnotes, endnotes,
  // comments, and the glossary (building blocks) subdocument. PII in any of
  // these survives in the exported file if it is not extracted and redacted.
  const headerFooterPaths: string[] = [];
  zip.forEach((relativePath) => {
    if (relativePath.match(/^word\/(?:(?:header|footer)\d*|footnotes|endnotes|comments)\.xml$/) ||
        relativePath === 'word/glossary/document.xml') {
      headerFooterPaths.push(relativePath);
    }
  });
  // Deterministic order so load-time and export-time extractions produce identical offsets
  headerFooterPaths.sort();

  for (const hfPath of headerFooterPaths) {
    const hfFile = zip.file(hfPath);
    if (!hfFile) continue;
    const hfXmlStr = await hfFile.async('string');
    const hfXmlDoc = parser.parseFromString(hfXmlStr, 'application/xml');
    if (hfXmlDoc.querySelector('parsererror')) continue;

    const hfExtraction = extractTextFromXml(hfXmlDoc);
    if (hfExtraction.plainText.length === 0) continue;

    const offset = combinedText.length + 1; // +1 for separator newline
    combinedText += '\n' + hfExtraction.plainText;

    // Adjust text node mappings to the combined text offset
    const adjustedNodes = hfExtraction.textNodes.map((node) => ({
      ...node,
      flatStart: node.flatStart + offset,
      flatEnd: node.flatEnd + offset,
    }));

    contentParts.push({
      path: hfPath,
      xmlDoc: hfXmlDoc,
      textNodes: adjustedNodes,
      paragraphBreaks: hfExtraction.paragraphBreaks.map((pb) => ({
        flatIndex: pb.flatIndex + offset,
      })),
      flatTextStart: offset,
      flatTextEnd: offset + hfExtraction.plainText.length,
    });
  }

  return {
    plainText: combinedText,
    xmlDoc,
    textNodes: contentParts.flatMap((cp) => cp.textNodes),
    paragraphBreaks: contentParts.flatMap((cp) => cp.paragraphBreaks),
    zip,
    documentXmlPath,
    contentParts,
  };
}

/**
 * A pairing of an original sensitive value with its replacement placeholder,
 * used to scrub places offset-based replacement cannot reach (relationship
 * targets, field instruction attributes).
 */
export interface ValueReplacement {
  value: string;
  replacement: string;
}

/**
 * Sort replacements and clamp overlapping ranges so each character is covered
 * by at most one replacement. Overlaps would otherwise double-apply and corrupt
 * the output around the overlap.
 */
export function normalizeReplacements(
  replacements: Array<{ start: number; end: number; replacement: string }>
): Array<{ start: number; end: number; replacement: string }> {
  const sorted = [...replacements].sort((a, b) => a.start - b.start || a.end - b.end);
  const result: Array<{ start: number; end: number; replacement: string }> = [];
  let lastEnd = -1;
  for (const repl of sorted) {
    const start = Math.max(repl.start, lastEnd);
    if (start >= repl.end) continue; // fully covered by the previous replacement
    result.push(start === repl.start ? repl : { ...repl, start });
    lastEnd = repl.end;
  }
  return result;
}

/**
 * Apply text replacements to the docx XML, preserving all formatting.
 * Takes the original extraction and a list of replacements (sorted by position),
 * and modifies the XML in-place. Also scrubs document metadata and relationship
 * targets that can leak identities (authors, revision names, hyperlink emails).
 *
 * Returns a new .docx file as a Blob.
 */
export async function writeAnonymizedDocx(
  extraction: DocxExtraction,
  replacements: Array<{ start: number; end: number; replacement: string }>,
  valueReplacements: ValueReplacement[] = []
): Promise<Blob> {
  const sorted = normalizeReplacements(replacements);

  // For each text node, compute what its new text should be
  // We need to handle replacements that may span multiple <w:t> elements

  // Build a map of flat-text ranges that need replacement
  // Process from end to start to preserve positions
  const reverseSorted = [...sorted].reverse();

  for (const repl of reverseSorted) {
    applyReplacement(extraction.textNodes, repl.start, repl.end, repl.replacement);
  }

  // Serialize all modified XML documents back to the zip
  const serializer = new XMLSerializer();
  for (const part of extraction.contentParts) {
    sanitizeContentPartAttributes(part.xmlDoc, valueReplacements);
    const xmlStr = serializer.serializeToString(part.xmlDoc);
    extraction.zip.file(part.path, xmlStr);
  }

  await sanitizeDocxMetadata(extraction.zip, valueReplacements);

  return extraction.zip.generateAsync({ type: 'blob', mimeType: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document' });
}

/**
 * Scrub identity-bearing attributes inside a content part:
 * - w:author / w:initials on tracked changes (w:ins, w:del) and comments
 * - alt text and object names on drawings (docPr, cNvPr)
 * - field instructions held in attributes (w:fldSimple @w:instr)
 */
function sanitizeContentPartAttributes(xmlDoc: Document, valueReplacements: ValueReplacement[]): void {
  const all = xmlDoc.getElementsByTagName('*');
  for (let i = 0; i < all.length; i++) {
    const el = all[i];
    const attrs = el.attributes;
    for (let a = 0; a < attrs.length; a++) {
      const attr = attrs[a];
      if (attr.localName === 'author') {
        attr.value = 'Redacted';
      } else if (attr.localName === 'initials') {
        attr.value = 'R';
      } else if (attr.localName === 'instr') {
        attr.value = replaceValues(attr.value, valueReplacements, false);
      }
    }
    if (el.localName === 'docPr' || el.localName === 'cNvPr') {
      if (el.hasAttribute('descr')) el.removeAttribute('descr');
      if (el.hasAttribute('title')) el.removeAttribute('title');
      if (el.hasAttribute('name')) el.setAttribute('name', 'Object');
    }
  }
}

/**
 * Replace every occurrence of each sensitive value (case-insensitive) in a string.
 * Uses a replacer function so '$' sequences in values or placeholders are inert.
 */
function replaceValues(input: string, valueReplacements: ValueReplacement[], urlEncode: boolean): string {
  let result = input;
  for (const { value, replacement } of valueReplacements) {
    if (!value) continue;
    const escaped = value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    const substitute = urlEncode ? encodeURIComponent(replacement) : replacement;
    result = result.replace(new RegExp(escaped, 'gi'), () => substitute);
  }
  return result;
}

/**
 * Scrub metadata parts of the package that survive text replacement untouched:
 * document properties, comment author registry, revision fingerprints,
 * mail-merge sources, external relationship targets, and the package thumbnail.
 */
async function sanitizeDocxMetadata(zip: JSZip, valueReplacements: ValueReplacement[]): Promise<void> {
  const parser = new DOMParser();
  const serializer = new XMLSerializer();

  const readXml = async (path: string): Promise<Document | null> => {
    const file = zip.file(path);
    if (!file) return null;
    const xmlStr = await file.async('string');
    const doc = parser.parseFromString(xmlStr, 'application/xml');
    if (doc.getElementsByTagName('parsererror').length > 0) return null;
    return doc;
  };
  const writeXml = (path: string, doc: Document) => {
    zip.file(path, serializer.serializeToString(doc));
  };
  const blankElementsByLocalName = (doc: Document, names: Set<string>) => {
    const all = doc.getElementsByTagName('*');
    for (let i = 0; i < all.length; i++) {
      if (names.has(all[i].localName)) all[i].textContent = '';
    }
  };

  // Core properties: author identities and content-describing fields
  const core = await readXml('docProps/core.xml');
  if (core) {
    blankElementsByLocalName(core, new Set(['creator', 'lastModifiedBy', 'title', 'subject', 'description', 'keywords', 'category']));
    writeXml('docProps/core.xml', core);
  }

  // Extended properties: organization and template/path hints
  const app = await readXml('docProps/app.xml');
  if (app) {
    blankElementsByLocalName(app, new Set(['Company', 'Manager', 'HyperlinkBase', 'Template']));
    writeXml('docProps/app.xml', app);
  }

  // Custom properties: blank all values, keep the property names/structure
  const custom = await readXml('docProps/custom.xml');
  if (custom) {
    const props = custom.getElementsByTagName('*');
    for (let i = 0; i < props.length; i++) {
      const el = props[i];
      if (el.localName !== 'property' && el.childElementCount === 0 && (el.textContent ?? '') !== '') {
        el.textContent = '';
      }
    }
    writeXml('docProps/custom.xml', custom);
  }

  // Comment author registry (word/people.xml): names and provider user ids
  const people = await readXml('word/people.xml');
  if (people) {
    const all = people.getElementsByTagName('*');
    for (let i = 0; i < all.length; i++) {
      const attrs = all[i].attributes;
      for (let a = 0; a < attrs.length; a++) {
        if (attrs[a].localName === 'author' || attrs[a].localName === 'userId') {
          attrs[a].value = 'Redacted';
        }
      }
    }
    writeXml('word/people.xml', people);
  }

  // Settings: drop mail-merge data sources, revision-save ids, attached template
  const settings = await readXml('word/settings.xml');
  if (settings) {
    for (const name of ['mailMerge', 'rsids', 'attachedTemplate']) {
      const els = settings.getElementsByTagNameNS(W_NS, name);
      for (let i = els.length - 1; i >= 0; i--) {
        els[i].parentNode?.removeChild(els[i]);
      }
    }
    writeXml('word/settings.xml', settings);
  }

  // Relationship files: scrub sensitive values from external targets
  // (hyperlink mailto:/URLs keep the raw value even when display text is redacted)
  // and detach the document template relationship.
  const relsPaths: string[] = [];
  zip.forEach((relativePath) => {
    if (/^word\/(?:glossary\/)?_rels\/[^/]+\.rels$/.test(relativePath)) {
      relsPaths.push(relativePath);
    }
  });
  for (const relsPath of relsPaths.sort()) {
    const rels = await readXml(relsPath);
    if (!rels) continue;
    const relationships = rels.getElementsByTagName('Relationship');
    for (let i = relationships.length - 1; i >= 0; i--) {
      const rel = relationships[i];
      const type = rel.getAttribute('Type') ?? '';
      if (type.endsWith('/attachedTemplate')) {
        rel.parentNode?.removeChild(rel);
        continue;
      }
      if (rel.getAttribute('TargetMode') === 'External') {
        const target = rel.getAttribute('Target') ?? '';
        const scrubbed = replaceValues(target, valueReplacements, true);
        if (scrubbed !== target) rel.setAttribute('Target', scrubbed);
      }
    }
    writeXml(relsPath, rels);
  }

  // Package thumbnail: a rendered image of page one leaks content wholesale.
  // Remove the part plus its package relationship and content-type override.
  const thumbnailPaths: string[] = [];
  zip.forEach((relativePath) => {
    if (/^docProps\/thumbnail\.[a-z]+$/i.test(relativePath)) {
      thumbnailPaths.push(relativePath);
    }
  });
  if (thumbnailPaths.length > 0) {
    for (const path of thumbnailPaths) zip.remove(path);
    const rootRels = await readXml('_rels/.rels');
    if (rootRels) {
      const relationships = rootRels.getElementsByTagName('Relationship');
      for (let i = relationships.length - 1; i >= 0; i--) {
        const type = relationships[i].getAttribute('Type') ?? '';
        if (type.endsWith('/thumbnail')) {
          relationships[i].parentNode?.removeChild(relationships[i]);
        }
      }
      writeXml('_rels/.rels', rootRels);
    }
    const contentTypes = await readXml('[Content_Types].xml');
    if (contentTypes) {
      const overrides = contentTypes.getElementsByTagName('Override');
      for (let i = overrides.length - 1; i >= 0; i--) {
        const partName = overrides[i].getAttribute('PartName') ?? '';
        if (thumbnailPaths.some((p) => partName === '/' + p)) {
          overrides[i].parentNode?.removeChild(overrides[i]);
        }
      }
      writeXml('[Content_Types].xml', contentTypes);
    }
  }
}

/**
 * Apply a single text replacement across potentially multiple <w:t> elements.
 */
function applyReplacement(
  textNodes: TextNodeMapping[],
  replStart: number,
  replEnd: number,
  replacement: string
): void {
  // Find all text nodes that overlap with this replacement range
  const affectedNodes: TextNodeMapping[] = [];
  for (const node of textNodes) {
    if (node.flatEnd > replStart && node.flatStart < replEnd) {
      affectedNodes.push(node);
    }
  }

  if (affectedNodes.length === 0) return;

  if (affectedNodes.length === 1) {
    // Simple case: replacement is within a single <w:t> element
    const node = affectedNodes[0];
    const currentText = node.element.textContent ?? '';
    const localStart = replStart - node.flatStart;
    const localEnd = replEnd - node.flatStart;
    const newText = currentText.slice(0, localStart) + replacement + currentText.slice(localEnd);
    node.element.textContent = newText;

    // Ensure space preservation
    node.element.setAttribute('xml:space', 'preserve');

    // Update flat positions for this node and all subsequent nodes
    const lengthDiff = replacement.length - (replEnd - replStart);
    node.flatEnd += lengthDiff;
    updateSubsequentNodes(textNodes, node, lengthDiff);
  } else {
    // Multi-node case: replacement spans multiple <w:t> elements
    // Put all replacement text in the first affected node, clear the rest
    const firstNode = affectedNodes[0];
    const lastNode = affectedNodes[affectedNodes.length - 1];

    const firstText = firstNode.element.textContent ?? '';
    const lastText = lastNode.element.textContent ?? '';

    const keepBefore = firstText.slice(0, replStart - firstNode.flatStart);
    const keepAfter = lastText.slice(replEnd - lastNode.flatStart);

    // Set first node to: text-before-replacement + replacement + text-after-replacement-in-last-node
    firstNode.element.textContent = keepBefore + replacement + keepAfter;
    firstNode.element.setAttribute('xml:space', 'preserve');

    // Clear intermediate and last nodes
    for (let i = 1; i < affectedNodes.length; i++) {
      affectedNodes[i].element.textContent = '';
    }

    // Recalculate flat positions
    const newFirstLength = (keepBefore + replacement + keepAfter).length;
    const oldSpanLength = lastNode.flatEnd - firstNode.flatStart;
    const lengthDiff = newFirstLength - oldSpanLength;

    // For cleared intermediate/last nodes, collapse their ranges
    firstNode.flatEnd = firstNode.flatStart + newFirstLength;
    for (let i = 1; i < affectedNodes.length; i++) {
      affectedNodes[i].flatStart = firstNode.flatEnd;
      affectedNodes[i].flatEnd = firstNode.flatEnd;
    }

    updateSubsequentNodes(textNodes, lastNode, lengthDiff);
  }
}

/**
 * Update flat positions for all text nodes after the given node.
 */
function updateSubsequentNodes(
  textNodes: TextNodeMapping[],
  afterNode: TextNodeMapping,
  lengthDiff: number
): void {
  if (lengthDiff === 0) return;
  let found = false;
  for (const node of textNodes) {
    if (found) {
      node.flatStart += lengthDiff;
      node.flatEnd += lengthDiff;
    } else if (node === afterNode) {
      found = true;
    }
  }
}

/**
 * Get the file extension from a filename.
 */
export function getFileExtension(filename: string): string {
  return filename.split('.').pop()?.toLowerCase() ?? '';
}

/**
 * Check if a file is a supported Word document (.doc or .docx).
 */
export function isWordFile(filename: string): boolean {
  const ext = getFileExtension(filename);
  return ext === 'docx' || ext === 'doc';
}

/**
 * Check if a file is a legacy .doc format (not .docx).
 */
export function isLegacyDoc(filename: string): boolean {
  return getFileExtension(filename) === 'doc';
}

/**
 * Check if a file is any supported document format.
 */
export function isSupportedFile(filename: string): boolean {
  return isWordFile(filename);
}
