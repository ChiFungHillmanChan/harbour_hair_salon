'use client';

interface ResultActionsProps {
  onDownload: () => void;
  disabled?: boolean;
}

export function ResultActions({ onDownload, disabled }: ResultActionsProps) {
  return (
    <button
      onClick={onDownload}
      disabled={disabled}
      className="w-full bg-accent text-black py-4 text-sm uppercase tracking-[0.2em] font-bold hover:bg-accent-light transition-all duration-300 hover:scale-[1.01] flex items-center justify-center gap-2 rounded-lg shadow-lg shadow-accent/10 disabled:opacity-40 disabled:cursor-not-allowed disabled:hover:scale-100"
    >
      <svg
        className="w-4 h-4"
        fill="none"
        viewBox="0 0 24 24"
        stroke="currentColor"
        strokeWidth={2.5}
      >
        <path
          strokeLinecap="round"
          strokeLinejoin="round"
          d="M4 16v1a3 3 0 003 3h10a3 3 0 003-3v-1m-4-4l-4 4m0 0l-4-4m4 4V4"
        />
      </svg>
      Download Result
    </button>
  );
}
