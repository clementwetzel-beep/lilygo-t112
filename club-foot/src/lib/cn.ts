/** Concatene des classes Tailwind en ignorant les valeurs falsy. */
export function cn(...classes: (string | false | null | undefined)[]): string {
  return classes.filter(Boolean).join(' ');
}
