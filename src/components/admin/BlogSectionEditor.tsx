'use client';

import { useState, type ChangeEvent } from 'react';
import type { BlogSection } from '@/app/services/blog-service';

interface BlogSectionEditorProps {
  initial?: BlogSection[];
}

const EMPTY_BY_TYPE: Record<BlogSection['type'], BlogSection> = {
  paragraph: { type: 'paragraph', text: '' },
  heading: { type: 'heading', level: 2, text: '' },
  list: { type: 'list', items: [''] },
  quote: { type: 'quote', text: '', attribution: '' },
};

type SectionType = BlogSection['type'];

export function BlogSectionEditor({ initial = [] }: BlogSectionEditorProps) {
  const [sections, setSections] = useState<BlogSection[]>(initial);

  const update = (next: BlogSection[]) => setSections(next);

  const addSection = (type: SectionType) => {
    const blank = structuredClone(EMPTY_BY_TYPE[type]);
    update([...sections, blank]);
  };

  const removeSection = (index: number) => {
    update(sections.filter((_, i) => i !== index));
  };

  const moveSection = (index: number, direction: -1 | 1) => {
    const target = index + direction;
    if (target < 0 || target >= sections.length) return;
    const next = [...sections];
    [next[index], next[target]] = [next[target], next[index]];
    update(next);
  };

  const updateSection = (index: number, patch: Partial<BlogSection>) => {
    const next = sections.map((s, i) => {
      if (i !== index) return s;
      return { ...s, ...patch } as BlogSection;
    });
    update(next);
  };

  const updateListItem = (sectionIndex: number, itemIndex: number, value: string) => {
    const next = sections.map((s, i) => {
      if (i !== sectionIndex || s.type !== 'list') return s;
      const items = s.items.map((it, j) => (j === itemIndex ? value : it));
      return { ...s, items };
    });
    update(next);
  };

  const addListItem = (sectionIndex: number) => {
    const next = sections.map((s, i) => {
      if (i !== sectionIndex || s.type !== 'list') return s;
      return { ...s, items: [...s.items, ''] };
    });
    update(next);
  };

  const removeListItem = (sectionIndex: number, itemIndex: number) => {
    const next = sections.map((s, i) => {
      if (i !== sectionIndex || s.type !== 'list') return s;
      return { ...s, items: s.items.filter((_, j) => j !== itemIndex) };
    });
    update(next);
  };

  return (
    <div className="space-y-6">
      {/* Hidden input — submitted with the form */}
      <input type="hidden" name="sectionsJson" value={JSON.stringify(sections)} />

      {sections.length === 0 ? (
        <div className="border-2 border-dashed border-zinc-300 rounded-lg p-10 text-center text-zinc-500">
          No content blocks yet. Add your first one below.
        </div>
      ) : (
        <ol className="space-y-4">
          {sections.map((section, i) => (
            <li
              key={i}
              className="bg-white border border-zinc-200 rounded-lg p-5 shadow-sm"
            >
              <div className="flex items-center justify-between mb-3">
                <div className="flex items-center gap-2">
                  <span className="text-[10px] uppercase tracking-wider font-bold px-2 py-1 rounded bg-zinc-900 text-white">
                    {section.type === 'heading' ? `Heading H${section.level}` : section.type}
                  </span>
                  <span className="text-xs text-zinc-400">Block {i + 1}</span>
                </div>
                <div className="flex items-center gap-1">
                  <button
                    type="button"
                    onClick={() => moveSection(i, -1)}
                    disabled={i === 0}
                    className="text-xs px-2 py-1 text-zinc-500 hover:text-zinc-900 disabled:opacity-30 disabled:cursor-not-allowed"
                    aria-label="Move up"
                  >
                    ↑
                  </button>
                  <button
                    type="button"
                    onClick={() => moveSection(i, 1)}
                    disabled={i === sections.length - 1}
                    className="text-xs px-2 py-1 text-zinc-500 hover:text-zinc-900 disabled:opacity-30 disabled:cursor-not-allowed"
                    aria-label="Move down"
                  >
                    ↓
                  </button>
                  <button
                    type="button"
                    onClick={() => removeSection(i)}
                    className="text-xs px-2 py-1 text-red-500 hover:text-red-700"
                    aria-label="Delete"
                  >
                    ✕
                  </button>
                </div>
              </div>

              {section.type === 'paragraph' && (
                <textarea
                  rows={4}
                  value={section.text}
                  onChange={(e: ChangeEvent<HTMLTextAreaElement>) =>
                    updateSection(i, { text: e.target.value })
                  }
                  placeholder="Write your paragraph..."
                  className="w-full border border-zinc-300 rounded px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-zinc-900 focus:border-transparent"
                />
              )}

              {section.type === 'heading' && (
                <div className="space-y-3">
                  <div className="flex gap-2">
                    <button
                      type="button"
                      onClick={() => updateSection(i, { level: 2 })}
                      className={`text-xs px-3 py-1 rounded border ${
                        section.level === 2
                          ? 'bg-zinc-900 text-white border-zinc-900'
                          : 'bg-white text-zinc-600 border-zinc-300'
                      }`}
                    >
                      H2
                    </button>
                    <button
                      type="button"
                      onClick={() => updateSection(i, { level: 3 })}
                      className={`text-xs px-3 py-1 rounded border ${
                        section.level === 3
                          ? 'bg-zinc-900 text-white border-zinc-900'
                          : 'bg-white text-zinc-600 border-zinc-300'
                      }`}
                    >
                      H3
                    </button>
                  </div>
                  <input
                    type="text"
                    value={section.text}
                    onChange={(e) => updateSection(i, { text: e.target.value })}
                    placeholder="Heading text..."
                    className="w-full border border-zinc-300 rounded px-3 py-2 text-base font-serif focus:outline-none focus:ring-2 focus:ring-zinc-900 focus:border-transparent"
                  />
                </div>
              )}

              {section.type === 'list' && (
                <div className="space-y-2">
                  {section.items.map((item, j) => (
                    <div key={j} className="flex gap-2 items-start">
                      <span className="pt-2.5 text-zinc-400">•</span>
                      <input
                        type="text"
                        value={item}
                        onChange={(e) => updateListItem(i, j, e.target.value)}
                        placeholder="List item..."
                        className="flex-1 border border-zinc-300 rounded px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-zinc-900 focus:border-transparent"
                      />
                      <button
                        type="button"
                        onClick={() => removeListItem(i, j)}
                        disabled={section.items.length === 1}
                        className="text-xs px-2 py-2 text-red-500 hover:text-red-700 disabled:opacity-30 disabled:cursor-not-allowed"
                      >
                        ✕
                      </button>
                    </div>
                  ))}
                  <button
                    type="button"
                    onClick={() => addListItem(i)}
                    className="text-xs font-medium text-zinc-600 hover:text-zinc-900 border border-dashed border-zinc-300 px-3 py-2 rounded"
                  >
                    + Add item
                  </button>
                </div>
              )}

              {section.type === 'quote' && (
                <div className="space-y-3">
                  <textarea
                    rows={3}
                    value={section.text}
                    onChange={(e) => updateSection(i, { text: e.target.value })}
                    placeholder="Quote text..."
                    className="w-full border border-zinc-300 rounded px-3 py-2 text-sm italic focus:outline-none focus:ring-2 focus:ring-zinc-900 focus:border-transparent"
                  />
                  <input
                    type="text"
                    value={section.attribution ?? ''}
                    onChange={(e) => updateSection(i, { attribution: e.target.value })}
                    placeholder="Attribution (optional)"
                    className="w-full border border-zinc-300 rounded px-3 py-2 text-xs focus:outline-none focus:ring-2 focus:ring-zinc-900 focus:border-transparent"
                  />
                </div>
              )}
            </li>
          ))}
        </ol>
      )}

      <div className="flex flex-wrap gap-2 pt-2">
        <p className="w-full text-xs uppercase tracking-wider text-zinc-500 font-medium mb-1">
          Add block:
        </p>
        <button
          type="button"
          onClick={() => addSection('paragraph')}
          className="text-xs px-3 py-2 bg-zinc-100 hover:bg-zinc-200 text-zinc-700 rounded font-medium transition-colors"
        >
          + Paragraph
        </button>
        <button
          type="button"
          onClick={() => addSection('heading')}
          className="text-xs px-3 py-2 bg-zinc-100 hover:bg-zinc-200 text-zinc-700 rounded font-medium transition-colors"
        >
          + Heading
        </button>
        <button
          type="button"
          onClick={() => addSection('list')}
          className="text-xs px-3 py-2 bg-zinc-100 hover:bg-zinc-200 text-zinc-700 rounded font-medium transition-colors"
        >
          + List
        </button>
        <button
          type="button"
          onClick={() => addSection('quote')}
          className="text-xs px-3 py-2 bg-zinc-100 hover:bg-zinc-200 text-zinc-700 rounded font-medium transition-colors"
        >
          + Quote
        </button>
      </div>
    </div>
  );
}
