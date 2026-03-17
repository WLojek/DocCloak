import type { DetectedEntity } from '../../core/types.ts';
import { ENTITY_COLORS } from '../../core/types.ts';

interface Segment {
  text: string;
  entity?: DetectedEntity;
}

function buildSegments(text: string, entities: DetectedEntity[]): Segment[] {
  if (!text || !entities || entities.length === 0) return [{ text }];

  const sorted = [...entities].sort((a, b) => a.start - b.start);
  const segments: Segment[] = [];
  let cursor = 0;

  for (const entity of sorted) {
    if (entity.start > cursor) {
      segments.push({ text: text.slice(cursor, entity.start) });
    }
    segments.push({ text: text.slice(entity.start, entity.end), entity });
    cursor = entity.end;
  }
  if (cursor < text.length) {
    segments.push({ text: text.slice(cursor) });
  }
  return segments;
}

interface HighlightedTextProps {
  text: string;
  entities: DetectedEntity[];
}

export function HighlightedText({ text, entities }: HighlightedTextProps) {
  const segments = buildSegments(text, entities);

  return (
    <>
      {segments.map((seg, i) =>
        seg.entity ? (
          <mark
            key={i}
            style={{
              backgroundColor: ENTITY_COLORS[seg.entity.type] + '30',
              borderBottom: `2px solid ${ENTITY_COLORS[seg.entity.type]}`,
              color: 'inherit',
              borderRadius: '2px',
              padding: '0 1px',
            }}
          >
            {seg.text}
          </mark>
        ) : (
          <span key={i}>{seg.text}</span>
        )
      )}
    </>
  );
}
