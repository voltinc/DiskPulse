import type { ButtonHTMLAttributes } from 'react';

type Variant = 'default' | 'primary' | 'danger' | 'ghost';

const VARIANTS: Record<Variant, string> = {
  default: 'border-line bg-[#333] text-ink hover:bg-[#3b3b3b] active:bg-[#2f2f2f]',
  primary: 'border-accent-strong bg-accent-strong text-white hover:bg-[#2b86e0] active:bg-[#196ab9]',
  danger: 'border-[#a8362e] bg-[#b83a31] text-white hover:bg-[#c8443a] active:bg-[#a23229]',
  ghost: 'border-transparent bg-transparent text-ink-2 hover:bg-white/10 hover:text-ink',
};

export function Button({
  variant = 'default',
  className = '',
  ...rest
}: ButtonHTMLAttributes<HTMLButtonElement> & { variant?: Variant }) {
  return (
    <button
      {...rest}
      className={`inline-flex h-7 items-center justify-center gap-1.5 whitespace-nowrap rounded border px-3 text-base transition-colors disabled:pointer-events-none disabled:opacity-45 ${VARIANTS[variant]} ${className}`}
    />
  );
}
