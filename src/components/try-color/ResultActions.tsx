'use client';

interface ResultActionsProps {
  onDownload: () => void;
}

export function ResultActions({ onDownload }: ResultActionsProps) {
  return (
    <div className="flex gap-3">
      <button
        onClick={onDownload}
        className="flex-1 bg-[var(--accent)] text-black py-3 text-sm uppercase tracking-[0.15em] font-bold hover:bg-[var(--accent-light)] transition-colors duration-300 rounded-lg flex items-center justify-center gap-2"
      >
        <svg
          className="w-4 h-4"
          fill="none"
          viewBox="0 0 24 24"
          stroke="currentColor"
          strokeWidth={2}
        >
          <path
            strokeLinecap="round"
            strokeLinejoin="round"
            d="M4 16v1a3 3 0 003 3h10a3 3 0 003-3v-1m-4-4l-4 4m0 0l-4-4m4 4V4"
          />
        </svg>
        Download
      </button>
    </div>
  );
}
