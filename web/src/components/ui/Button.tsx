import type { ButtonHTMLAttributes } from 'react';

type Props = ButtonHTMLAttributes<HTMLButtonElement> & { variant?: 'primary' | 'danger' | 'ghost' };

export function Button({ variant = 'primary', className = '', ...props }: Props) {
  const base = 'px-3 py-1.5 rounded-md text-sm font-medium disabled:opacity-50 disabled:cursor-not-allowed';
  const variants = {
    primary: 'bg-accent text-white hover:opacity-90',
    danger: 'bg-danger text-white hover:opacity-90',
    ghost: 'bg-transparent border border-border text-text hover:bg-surface',
  };
  return <button className={`${base} ${variants[variant]} ${className}`} {...props} />;
}
