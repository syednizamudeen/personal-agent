import type { ReactNode } from 'react';

export function Table({ children }: { children: ReactNode }) {
  return (
    <div className="overflow-x-auto border border-border rounded-lg">
      <table className="w-full text-sm text-left">{children}</table>
    </div>
  );
}

export function Th({ children }: { children: ReactNode }) {
  return <th className="px-3 py-2 bg-surface border-b border-border text-muted font-medium">{children}</th>;
}

export function Td({ children }: { children: ReactNode }) {
  return <td className="px-3 py-2 border-b border-border">{children}</td>;
}
