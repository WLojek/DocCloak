import { describe, it, expect } from 'vitest';
import JSZip from 'jszip';
import { readDocx, writeAnonymizedDocx, normalizeReplacements } from '../../src/core/docx.ts';

const W = 'http://schemas.openxmlformats.org/wordprocessingml/2006/main';
const V = 'urn:schemas-microsoft-com:vml';
const REL = 'http://schemas.openxmlformats.org/package/2006/relationships';

function documentXml(): string {
  return `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<w:document xmlns:w="${W}" xmlns:v="${V}">
  <w:body>
    <w:p><w:r><w:t>Contact John Smith at jane@acme.com today.</w:t></w:r></w:p>
    <w:p>
      <w:r><w:t>Deleted below stays in the file:</w:t></w:r>
      <w:del w:id="1" w:author="Alice Reviewer" w:date="2024-01-01T00:00:00Z">
        <w:r><w:delText>secret SSN 123-45-6789</w:delText></w:r>
      </w:del>
      <w:ins w:id="2" w:author="Alice Reviewer" w:date="2024-01-01T00:00:00Z">
        <w:r><w:t>inserted text</w:t></w:r>
      </w:ins>
    </w:p>
    <w:p>
      <w:r><w:fldChar w:fldCharType="begin"/></w:r>
      <w:r><w:instrText> HYPERLINK "mailto:jane@acme.com" </w:instrText></w:r>
      <w:r><w:fldChar w:fldCharType="end"/></w:r>
      <w:r><w:t>write to us</w:t></w:r>
    </w:p>
    <w:p>
      <w:r><w:t>Outer OUTERNAME text</w:t></w:r>
      <w:r><w:pict><v:shape><v:textbox><w:txbxContent>
        <w:p><w:r><w:t>Box BOXNAME inside</w:t></w:r></w:p>
      </w:txbxContent></v:textbox></v:shape></w:pict></w:r>
    </w:p>
  </w:body>
</w:document>`;
}

function footnotesXml(): string {
  return `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<w:footnotes xmlns:w="${W}">
  <w:footnote w:id="1">
    <w:p><w:r><w:t>Case handled by Maria Kowalska.</w:t></w:r></w:p>
  </w:footnote>
</w:footnotes>`;
}

function commentsXml(): string {
  return `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<w:comments xmlns:w="${W}">
  <w:comment w:id="1" w:author="Bob Commenter" w:initials="BC">
    <w:p><w:r><w:t>Check with Maria Kowalska first.</w:t></w:r></w:p>
  </w:comment>
</w:comments>`;
}

function buildDocx(): JSZip {
  const zip = new JSZip();
  zip.file('[Content_Types].xml', `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">
  <Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/>
  <Default Extension="xml" ContentType="application/xml"/>
  <Default Extension="jpeg" ContentType="image/jpeg"/>
  <Override PartName="/word/document.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml"/>
  <Override PartName="/docProps/thumbnail.jpeg" ContentType="image/jpeg"/>
</Types>`);
  zip.file('_rels/.rels', `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Relationships xmlns="${REL}">
  <Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="word/document.xml"/>
  <Relationship Id="rId2" Type="http://schemas.openxmlformats.org/package/2006/relationships/metadata/thumbnail" Target="docProps/thumbnail.jpeg"/>
</Relationships>`);
  zip.file('word/document.xml', documentXml());
  zip.file('word/footnotes.xml', footnotesXml());
  zip.file('word/comments.xml', commentsXml());
  zip.file('word/_rels/document.xml.rels', `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Relationships xmlns="${REL}">
  <Relationship Id="rId5" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/hyperlink" Target="mailto:jane@acme.com" TargetMode="External"/>
  <Relationship Id="rId6" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/attachedTemplate" Target="file:///C:/Users/realuser/Templates/secret.dotm" TargetMode="External"/>
</Relationships>`);
  zip.file('word/settings.xml', `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<w:settings xmlns:w="${W}">
  <w:zoom w:percent="100"/>
  <w:mailMerge><w:dataSource w:name="C:\\clients\\list.xlsx"/></w:mailMerge>
  <w:rsids><w:rsid w:val="00AB12CD"/></w:rsids>
</w:settings>`);
  zip.file('docProps/core.xml', `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<cp:coreProperties xmlns:cp="http://schemas.openxmlformats.org/package/2006/metadata/core-properties" xmlns:dc="http://purl.org/dc/elements/1.1/">
  <dc:title>Acme vs Smith settlement</dc:title>
  <dc:creator>Real Author</dc:creator>
  <cp:lastModifiedBy>Another Person</cp:lastModifiedBy>
</cp:coreProperties>`);
  zip.file('docProps/app.xml', `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Properties xmlns="http://schemas.openxmlformats.org/officeDocument/2006/extended-properties">
  <Company>Acme Legal LLP</Company>
  <Application>MSWord</Application>
</Properties>`);
  zip.file('docProps/thumbnail.jpeg', new Uint8Array([0xff, 0xd8, 0xff, 0xe0, 1, 2, 3]));
  return zip;
}

async function zipToFile(zip: JSZip): Promise<File> {
  const ab = await zip.generateAsync({ type: 'arraybuffer' });
  const file = new File([ab], 'test.docx');
  // jsdom's File lacks arrayBuffer(); polyfill it for the code under test
  if (typeof file.arrayBuffer !== 'function') {
    Object.defineProperty(file, 'arrayBuffer', { value: async () => ab });
  }
  return file;
}

function blobToArrayBuffer(blob: Blob): Promise<ArrayBuffer> {
  if (typeof blob.arrayBuffer === 'function') return blob.arrayBuffer();
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(reader.result as ArrayBuffer);
    reader.onerror = () => reject(reader.error);
    reader.readAsArrayBuffer(blob);
  });
}

function findAll(haystack: string, needle: string): Array<{ start: number; end: number }> {
  const result: Array<{ start: number; end: number }> = [];
  let idx = haystack.indexOf(needle);
  while (idx !== -1) {
    result.push({ start: idx, end: idx + needle.length });
    idx = haystack.indexOf(needle, idx + 1);
  }
  return result;
}

describe('readDocx', () => {
  it('extracts text from footnotes, comments, tracked deletions and field instructions', async () => {
    const extraction = await readDocx(await zipToFile(buildDocx()));
    expect(extraction.plainText).toContain('John Smith');
    expect(extraction.plainText).toContain('secret SSN 123-45-6789'); // w:delText
    expect(extraction.plainText).toContain('mailto:jane@acme.com'); // w:instrText
    expect(extraction.plainText).toContain('Case handled by Maria Kowalska.'); // footnote
    expect(extraction.plainText).toContain('Check with Maria Kowalska first.'); // comment
  });

  it('maps text inside text boxes exactly once', async () => {
    const extraction = await readDocx(await zipToFile(buildDocx()));
    expect(findAll(extraction.plainText, 'BOXNAME')).toHaveLength(1);
    const covering = extraction.textNodes.filter((n) => {
      const { start } = findAll(extraction.plainText, 'BOXNAME')[0];
      return n.flatStart <= start && n.flatEnd > start;
    });
    expect(covering).toHaveLength(1);
  });

  it('produces identical extractions across repeated reads', async () => {
    const file = await zipToFile(buildDocx());
    const a = await readDocx(file);
    const b = await readDocx(file);
    expect(a.plainText).toBe(b.plainText);
  });
});

describe('writeAnonymizedDocx', () => {
  async function redactAll(): Promise<Map<string, string>> {
    const extraction = await readDocx(await zipToFile(buildDocx()));
    const targets = ['John Smith', 'jane@acme.com', '123-45-6789', 'Maria Kowalska', 'BOXNAME'];
    const replacements: Array<{ start: number; end: number; replacement: string }> = [];
    const valueReplacements: Array<{ value: string; replacement: string }> = [];
    targets.forEach((value, i) => {
      const placeholder = `<<REDACTED_${i + 1}>>`;
      valueReplacements.push({ value, replacement: placeholder });
      for (const range of findAll(extraction.plainText, value)) {
        replacements.push({ ...range, replacement: placeholder });
      }
    });
    const blob = await writeAnonymizedDocx(extraction, replacements, valueReplacements);
    const outZip = await JSZip.loadAsync(await blobToArrayBuffer(blob));
    const contents = new Map<string, string>();
    for (const path of Object.keys(outZip.files)) {
      const f = outZip.file(path);
      if (f && !path.endsWith('/')) {
        contents.set(path, await f.async('string'));
      }
    }
    return contents;
  }

  it('redacts body text, tracked deletions, footnotes and comments', async () => {
    const out = await redactAll();
    const doc = out.get('word/document.xml')!;
    expect(doc).not.toContain('John Smith');
    expect(doc).not.toContain('123-45-6789');
    expect(doc).not.toContain('jane@acme.com');
    expect(out.get('word/footnotes.xml')!).not.toContain('Maria Kowalska');
    expect(out.get('word/comments.xml')!).not.toContain('Maria Kowalska');
    expect(doc).toContain('&lt;&lt;REDACTED_1&gt;&gt;');
  });

  it('does not corrupt text-box content via double replacement', async () => {
    const out = await redactAll();
    const doc = out.get('word/document.xml')!;
    expect(doc).not.toContain('BOXNAME');
    expect(findAll(doc, 'REDACTED_5')).toHaveLength(1);
    expect(doc).toContain('Outer OUTERNAME text');
  });

  it('scrubs revision and comment author identities', async () => {
    const out = await redactAll();
    expect(out.get('word/document.xml')!).not.toContain('Alice Reviewer');
    expect(out.get('word/comments.xml')!).not.toContain('Bob Commenter');
    expect(out.get('word/comments.xml')!).not.toContain('"BC"');
  });

  it('scrubs document properties', async () => {
    const out = await redactAll();
    const core = out.get('docProps/core.xml')!;
    expect(core).not.toContain('Real Author');
    expect(core).not.toContain('Another Person');
    expect(core).not.toContain('Acme vs Smith');
    const app = out.get('docProps/app.xml')!;
    expect(app).not.toContain('Acme Legal LLP');
    expect(app).toContain('MSWord'); // application name is kept
  });

  it('scrubs hyperlink targets and removes the attached template relationship', async () => {
    const out = await redactAll();
    const rels = out.get('word/_rels/document.xml.rels')!;
    expect(rels).not.toContain('jane@acme.com');
    expect(rels).not.toContain('attachedTemplate');
    expect(rels).not.toContain('realuser');
  });

  it('removes mail merge sources, rsids and the thumbnail', async () => {
    const out = await redactAll();
    const settings = out.get('word/settings.xml')!;
    expect(settings).not.toContain('mailMerge');
    expect(settings).not.toContain('rsid');
    expect(out.has('docProps/thumbnail.jpeg')).toBe(false);
    expect(out.get('_rels/.rels')!).not.toContain('thumbnail');
    expect(out.get('[Content_Types].xml')!).not.toContain('thumbnail');
  });
});

describe('normalizeReplacements', () => {
  it('clamps overlapping ranges so they never double-apply', () => {
    const result = normalizeReplacements([
      { start: 10, end: 20, replacement: 'B' },
      { start: 5, end: 15, replacement: 'A' },
    ]);
    expect(result).toEqual([
      { start: 5, end: 15, replacement: 'A' },
      { start: 15, end: 20, replacement: 'B' },
    ]);
  });

  it('drops ranges fully covered by an earlier one', () => {
    const result = normalizeReplacements([
      { start: 0, end: 30, replacement: 'A' },
      { start: 5, end: 15, replacement: 'B' },
    ]);
    expect(result).toEqual([{ start: 0, end: 30, replacement: 'A' }]);
  });
});
