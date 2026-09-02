import type { ButtonHTMLAttributes, HTMLAttributes, ReactNode } from 'react';
import { cn } from '@/lib/cn';

export function Spinner({ label = 'Chargement' }: { label?: string }) {
  return (
    <div className="flex min-h-40 items-center justify-center" role="status" aria-label={label}>
      <div className="h-8 w-8 animate-spin rounded-full border-2 border-slate-200 border-b-club-600" />
    </div>
  );
}

export function Card({ className, children, ...props }: HTMLAttributes<HTMLDivElement>) {
  return (
    <div
      className={cn('rounded-xl border border-slate-200 bg-white p-4 shadow-sm', className)}
      {...props}
    >
      {children}
    </div>
  );
}

type Ton = 'neutre' | 'vert' | 'rouge' | 'ambre' | 'bleu';

const TONS: Record<Ton, string> = {
  neutre: 'bg-slate-100 text-slate-700',
  vert: 'bg-club-100 text-club-700',
  rouge: 'bg-red-100 text-red-700',
  ambre: 'bg-amber-100 text-amber-800',
  bleu: 'bg-blue-100 text-blue-700',
};

export function Badge({ ton = 'neutre', children }: { ton?: Ton; children: ReactNode }) {
  return (
    <span
      className={cn(
        'inline-flex items-center rounded-full px-2 py-0.5 text-xs font-medium',
        TONS[ton],
      )}
    >
      {children}
    </span>
  );
}

interface ButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  variante?: 'primaire' | 'secondaire' | 'fantome';
}

const VARIANTES = {
  primaire: 'bg-club-600 text-white hover:bg-club-700 disabled:bg-club-200',
  secondaire: 'border border-slate-300 bg-white text-slate-800 hover:bg-slate-50',
  fantome: 'text-slate-600 hover:bg-slate-100',
} as const;

export function Button({ variante = 'primaire', className, ...props }: ButtonProps) {
  return (
    <button
      className={cn(
        'inline-flex items-center justify-center gap-2 rounded-lg px-3 py-2 text-sm font-medium transition-colors disabled:cursor-not-allowed disabled:opacity-70',
        VARIANTES[variante],
        className,
      )}
      {...props}
    />
  );
}

export function EmptyState({
  titre,
  description,
  action,
}: {
  titre: string;
  description?: string;
  action?: ReactNode;
}) {
  return (
    <Card className="flex flex-col items-center gap-2 py-10 text-center">
      <p className="font-medium text-slate-800">{titre}</p>
      {description && <p className="max-w-sm text-sm text-slate-500">{description}</p>}
      {action}
    </Card>
  );
}

export function PageTitre({ titre, sousTitre }: { titre: string; sousTitre?: string }) {
  return (
    <header className="mb-4">
      <h1 className="text-xl font-semibold text-slate-900">{titre}</h1>
      {sousTitre && <p className="text-sm text-slate-500">{sousTitre}</p>}
    </header>
  );
}
