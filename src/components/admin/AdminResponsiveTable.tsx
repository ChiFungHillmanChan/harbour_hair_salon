import type { ComponentProps } from 'react';

/** One set of rows and actions: labelled cards on phones, a table on larger screens. */
export function AdminResponsiveTable({ className = '', ...props }: ComponentProps<'table'>) {
  return <table
    {...props}
    role="table"
    className={`w-full ${className}
      max-md:block max-md:[&_thead]:sr-only max-md:[&_tbody]:block max-md:[&_tbody]:space-y-3
      max-md:[&_tbody>tr]:grid max-md:[&_tbody>tr]:grid-cols-2 max-md:[&_tbody>tr]:gap-x-3 max-md:[&_tbody>tr]:gap-y-2
      max-md:[&_tbody>tr]:rounded-lg max-md:[&_tbody>tr]:border max-md:[&_tbody>tr]:border-zinc-200 max-md:[&_tbody>tr]:bg-white max-md:[&_tbody>tr]:p-3
      max-md:[&_td]:block max-md:[&_td]:min-w-0 max-md:[&_td]:w-auto max-md:[&_td]:border-0 max-md:[&_td]:p-0 max-md:[&_td]:text-left max-md:[&_td]:whitespace-normal max-md:[&_td]:[overflow-wrap:anywhere]
      max-md:[&_td[data-label]]:before:mb-1 max-md:[&_td[data-label]]:before:block max-md:[&_td[data-label]]:before:text-xs max-md:[&_td[data-label]]:before:font-medium max-md:[&_td[data-label]]:before:text-zinc-500 max-md:[&_td[data-label]]:before:content-[attr(data-label)]
      max-md:[&_td[data-primary]]:col-span-2 max-md:[&_td[data-primary]]:pb-1 max-md:[&_td[data-primary]]:before:hidden
      max-md:[&_td[data-actions]]:col-span-2 max-md:[&_td[colspan]]:col-span-2
      max-md:[&_td[data-actions]>div]:flex-wrap max-md:[&_td[data-actions]>div]:justify-start
    `}
  />;
}
