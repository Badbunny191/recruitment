import { type ClassValue, clsx } from 'clsx';
import { twMerge } from 'tailwind-merge';

/** Classname utility ที่รวม clsx + tailwind-merge */
export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs));
}
