import type { InputHTMLAttributes } from 'react';

export function Input(props: InputHTMLAttributes<HTMLInputElement>) {
  return (
    <input
      {...props}
      className={`w-full px-3 py-1.5 rounded-md bg-surface border border-border text-text placeholder:text-muted focus:outline-none focus:ring-1 focus:ring-accent ${props.className ?? ''}`}
    />
  );
}
