import React from 'react';

const routerCalls: Array<[string, string]> = [];

export function useSearchParams(): URLSearchParams {
  return new URLSearchParams('id=round-test');
}

export function useRouter() {
  return {
    push: (href: string) => {
      routerCalls.push(['push', href]);
    },
    replace: (href: string) => {
      routerCalls.push(['replace', href]);
    },
    back: () => {
      routerCalls.push(['back', '']);
    },
    prefetch: () => {},
  };
}

export function usePathname() {
  return '/apply';
}

export { routerCalls };
