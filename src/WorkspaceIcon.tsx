const paths = {
  pdf: 'M3 4h12v12H3z M6 8h6 M6 11h4',
  split: 'M2.5 4h15v12h-15z M10 4v12',
  card: 'M5 4h12v12H5z M8 8h6 M8 11h3',
  more: 'M4 10h.01 M10 10h.01 M16 10h.01',
  plus: 'M4 10h12 M10 4v12',
  minus: 'M4 10h12',
  import: 'M10 3v9 M7 9l3 3 3-3 M4 12v4h12v-4',
  export: 'M10 12V3 M7 6l3-3 3 3 M4 12v4h12v-4',
  fit: 'M3 5v10 M17 5v10 M6 10h8 M8 8l-2 2 2 2 M12 8l2 2-2 2',
  select: 'M3 7V3h4 M13 3h4v4 M17 13v4h-4 M7 17H3v-4',
  insert: 'M3 7V3h4 M13 3h4v4 M7 17H3v-4 M13 11v6 M10 14h6',
  close: 'M5 5l10 10 M15 5 5 15',
  right: 'm8 5 5 5-5 5',
  left: 'm12 5-5 5 5 5',
  down: 'm5 8 5 5 5-5',
  link: 'M8 12l4-4 M7 13l-1 1a3 3 0 0 1-4-4l3-3a3 3 0 0 1 4 0 M13 7l1-1a3 3 0 0 1 4 4l-3 3a3 3 0 0 1-4 0',
  library: 'M3 4h3v12H3z M9 4h3v12H9z M14 5l2-.5 3 11-2 .5z',
  search: 'M13 13l4 4 M14 9a5 5 0 1 1-10 0 5 5 0 0 1 10 0',
} as const

export default function WorkspaceIcon({ name }: { name: keyof typeof paths }) {
  return (
    <svg aria-hidden="true" width="20" height="20" viewBox="0 0 20 20" fill="none"
      stroke="currentColor" strokeWidth={name === 'more' ? 2.6 : 1.5} strokeLinecap="round" strokeLinejoin="round">
      <path d={paths[name]} />
    </svg>
  )
}
