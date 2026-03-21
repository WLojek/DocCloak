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
 * Extract all <w:t> text from an XML document, building a flat text and position mapping.
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
    // For headers/footers, process the root element's children
    const root = xmlDoc.documentElement;
    processParagraphs(root);
  } else {
    processParagraphs(body);
  }

  function processParagraphs(parent: Element) {
    const paragraphs = parent.getElementsByTagNameNS(W_NS, 'p');
    for (let pi = 0; pi < paragraphs.length; pi++) {
      const para = paragraphs[pi];
      if (pi > 0) {
        paragraphBreaks.push({ flatIndex: flatText.length });
        flatText += '\n';
      }
      // Get all w:t elements within this paragraph's runs
      const tElements = para.getElementsByTagNameNS(W_NS, 't');
      for (let ti = 0; ti < tElements.length; ti++) {
        const tEl = tElements[ti];
        const text = tEl.textContent ?? '';
        if (text.length > 0) {
          textNodes.push({
            element: tEl,
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

  // Find header and footer files
  const headerFooterPaths: string[] = [];
  zip.forEach((relativePath) => {
    if (relativePath.match(/^word\/(header|footer)\d*\.xml$/)) {
      headerFooterPaths.push(relativePath);
    }
  });

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
 * Apply text replacements to the docx XML, preserving all formatting.
 * Takes the original extraction and a list of replacements (sorted by position),
 * and modifies the XML in-place.
 *
 * Returns a new .docx file as a Blob.
 */
export async function writeAnonymizedDocx(
  extraction: DocxExtraction,
  replacements: Array<{ start: number; end: number; replacement: string }>
): Promise<Blob> {
  // Sort replacements by start position (ascending) for processing
  const sorted = [...replacements].sort((a, b) => a.start - b.start);

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
    const xmlStr = serializer.serializeToString(part.xmlDoc);
    extraction.zip.file(part.path, xmlStr);
  }

  return extraction.zip.generateAsync({ type: 'blob', mimeType: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document' });
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
