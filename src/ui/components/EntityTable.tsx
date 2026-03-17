import { useState, useCallback, useEffect, useRef } from 'react';
import type { DetectedEntity, ReplacementEntry } from '../../core/types.ts';
import { ENTITY_COLORS } from '../../core/types.ts';
import { Card } from '@/components/ui/card';
import { Checkbox } from '@/components/ui/checkbox';
import { ChevronDown } from 'lucide-react';
import { useTranslation } from '../../i18n/LanguageContext.tsx';

interface EntityTableProps {
  entities: DetectedEntity[];
  entries: ReplacementEntry[];
  excludedIndices: Set<number>;
  onToggle: (index: number) => void;
  onRenameLabel: (original: string, newLabel: string) => void;
}

export function EntityTable({ entities, entries, excludedIndices, onToggle, onRenameLabel }: EntityTableProps) {
  const { t } = useTranslation();
  const [editingOriginal, setEditingOriginal] = useState<string | null>(null);
  const [editValue, setEditValue] = useState('');
  const [expanded, setExpanded] = useState(false);
  const prevEntityCount = useRef(0);

  // Reset collapsed state when entities are cleared (new redaction cycle)
  useEffect(() => {
    if (entities.length === 0) {
      prevEntityCount.current = 0;
    } else {
      prevEntityCount.current = entities.length;
    }
  }, [entities.length]);

  const startEditing = useCallback((original: string, currentLabel: string) => {
    setEditingOriginal(original);
    const inner = currentLabel.startsWith('<<') && currentLabel.endsWith('>>')
      ? currentLabel.slice(2, -2)
      : currentLabel;
    setEditValue(inner);
  }, []);

  const commitEdit = useCallback(() => {
    if (editingOriginal && editValue.trim()) {
      onRenameLabel(editingOriginal, `<<${editValue.trim()}>>`);
    }
    setEditingOriginal(null);
  }, [editingOriginal, editValue, onRenameLabel]);

  const renderLabel = (entity: DetectedEntity) => {
    const entry = entries.find(e => e.original === entity.value);
    const label = entry?.replacement ?? '\u2014';
    if (!entry) return label;
    if (editingOriginal === entity.value) {
      return (
        <span className="inline-flex items-center gap-0">
          <span className="text-muted-foreground/50">&lt;&lt;</span>
          <input
            autoFocus
            value={editValue}
            onChange={(e) => setEditValue(e.target.value)}
            onBlur={commitEdit}
            onKeyDown={(e) => {
              if (e.key === 'Enter') commitEdit();
              if (e.key === 'Escape') setEditingOriginal(null);
            }}
            className="bg-[#E5E5E0] border border-[#111111] px-1.5 py-0.5 text-xs font-mono text-[#111111] focus:outline-none focus:ring-1 focus:ring-[#111111]"
            style={{ width: `${Math.max(editValue.length + 1, 5)}ch` }}
          />
          <span className="text-muted-foreground/50">&gt;&gt;</span>
        </span>
      );
    }
    return (
      <span
        onClick={() => startEditing(entity.value, label)}
        className="cursor-pointer hover:text-[#CC0000] transition-colors"
        title={t.entityTable.clickToRename}
      >
        {label}
      </span>
    );
  };

  if (entities.length === 0) return null;

  return (
    <div className="mb-6">
      <button
        onClick={() => setExpanded(!expanded)}
        className="w-full flex items-center justify-between px-4 py-3 bg-[#111111] text-[#F9F9F7] cursor-pointer hover:bg-[#222222] transition-colors duration-150"
      >
        <h3 className="label-meta text-[#F9F9F7] tracking-[0.15em]">
          {t.entityTable.title(entities.length)}
        </h3>
        <ChevronDown
          className={`w-4 h-4 text-[#F9F9F7] transition-transform duration-200 ${expanded ? 'rotate-180' : ''}`}
        />
      </button>
      <div
        className="grid transition-all duration-300 ease-in-out"
        style={{ gridTemplateRows: expanded ? '1fr' : '0fr' }}
      >
        <div className="overflow-hidden">
      <Card className="overflow-hidden border-t-0 mt-0">
        {/* Desktop table */}
        <table className="w-full text-sm hidden md:table">
          <thead>
            <tr className="border-b border-[#E5E5E0] bg-[#E5E5E0]/30">
              <th className="text-left p-3 label-meta text-muted-foreground">{t.entityTable.type}</th>
              <th className="text-left p-3 label-meta text-muted-foreground">{t.entityTable.label}</th>
              <th className="text-left p-3 label-meta text-muted-foreground">{t.entityTable.originalValue}</th>
              <th className="text-left p-3 label-meta text-muted-foreground">{t.entityTable.confidence}</th>
              <th className="text-center p-3 label-meta text-muted-foreground">{t.entityTable.include}</th>
            </tr>
          </thead>
          <tbody>
            {entities.map((entity, index) => {
              const excluded = excludedIndices.has(index);
              return (
                <tr
                  key={`${entity.start}-${entity.value}`}
                  className={`border-b border-[#E5E5E0] last:border-0 hover:bg-[#E5E5E0]/20 transition-colors ${
                    excluded ? 'opacity-40' : ''
                  }`}
                >
                  <td className="p-3">
                    <span
                      className="inline-flex items-center gap-1.5 px-2 py-0.5 text-xs font-medium"
                      style={{
                        backgroundColor: ENTITY_COLORS[entity.type] + '25',
                        color: ENTITY_COLORS[entity.type],
                      }}
                    >
                      <span
                        className="w-2 h-2"
                        style={{ backgroundColor: ENTITY_COLORS[entity.type] }}
                      />
                      {t.entityLabels[entity.type]}
                    </span>
                  </td>
                  <td className="p-3 text-muted-foreground text-xs font-mono">
                    {renderLabel(entity)}
                  </td>
                  <td className="p-3 text-foreground font-mono text-xs">{entity.value}</td>
                  <td className="p-3">
                    <div className="flex items-center gap-2">
                      <div className="w-14 bg-[#E5E5E0] h-1.5 overflow-hidden">
                        <div
                          className={`h-full transition-all ${
                            entity.confidence > 0.8 ? 'bg-[#2D6A4F]' : entity.confidence > 0.5 ? 'bg-[#B8860B]' : 'bg-[#CC0000]'
                          }`}
                          style={{ width: `${Math.round(entity.confidence * 100)}%` }}
                        />
                      </div>
                      <span className="text-xs text-muted-foreground tabular-nums">{Math.round(entity.confidence * 100)}%</span>
                    </div>
                  </td>
                  <td className="p-3 text-center">
                    <Checkbox
                      checked={!excluded}
                      onCheckedChange={() => onToggle(index)}
                      aria-label={excluded ? t.entityTable.includeEntity : t.entityTable.excludeEntity}
                    />
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>

        {/* Mobile card layout */}
        <div className="md:hidden divide-y divide-[#E5E5E0]">
          {entities.map((entity, index) => {
            const excluded = excludedIndices.has(index);
            return (
              <div
                key={`m-${entity.start}-${entity.value}`}
                className={`p-3 space-y-2 ${excluded ? 'opacity-40' : ''}`}
              >
                <div className="flex items-center justify-between">
                  <span
                    className="inline-flex items-center gap-1.5 px-2 py-0.5 text-xs font-medium"
                    style={{
                      backgroundColor: ENTITY_COLORS[entity.type] + '25',
                      color: ENTITY_COLORS[entity.type],
                    }}
                  >
                    <span className="w-2 h-2" style={{ backgroundColor: ENTITY_COLORS[entity.type] }} />
                    {t.entityLabels[entity.type]}
                  </span>
                  <Checkbox
                    checked={!excluded}
                    onCheckedChange={() => onToggle(index)}
                    aria-label={excluded ? t.entityTable.includeEntity : t.entityTable.excludeEntity}
                  />
                </div>
                <div className="text-xs font-mono text-foreground truncate">{entity.value}</div>
                <div className="flex items-center justify-between">
                  <span className="text-xs font-mono text-muted-foreground">{renderLabel(entity)}</span>
                  <div className="flex items-center gap-2">
                    <div className="w-10 bg-[#E5E5E0] h-1.5 overflow-hidden">
                      <div
                        className={`h-full ${
                          entity.confidence > 0.8 ? 'bg-[#2D6A4F]' : entity.confidence > 0.5 ? 'bg-[#B8860B]' : 'bg-[#CC0000]'
                        }`}
                        style={{ width: `${Math.round(entity.confidence * 100)}%` }}
                      />
                    </div>
                    <span className="text-[10px] text-muted-foreground tabular-nums">{Math.round(entity.confidence * 100)}%</span>
                  </div>
                </div>
              </div>
            );
          })}
        </div>
      </Card>
        </div>
      </div>
    </div>
  );
}
