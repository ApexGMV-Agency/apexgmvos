// Pick a Bootstrap icon class based on a URL's host/pathname.
export function resourceIcon(url: string): { icon: string; color: string; label: string } {
  try {
    const u = new URL(url);
    const host = u.hostname.toLowerCase();
    const path = u.pathname.toLowerCase();
    if (host.includes('docs.google.com')) {
      if (path.includes('/spreadsheets')) return { icon: 'bi-file-earmark-spreadsheet', color: '#0f9d58', label: 'Google Sheets' };
      if (path.includes('/presentation')) return { icon: 'bi-file-earmark-slides',      color: '#f4b400', label: 'Google Slides' };
      if (path.includes('/forms'))        return { icon: 'bi-ui-checks',                color: '#7c4dff', label: 'Google Forms' };
      return { icon: 'bi-file-earmark-text', color: '#4285f4', label: 'Google Docs' };
    }
    if (host.includes('drive.google.com'))  return { icon: 'bi-hdd',         color: '#4285f4', label: 'Google Drive' };
    if (host.includes('notion.so') || host.includes('notion.site')) return { icon: 'bi-journal-text', color: '#000',   label: 'Notion' };
    if (host.includes('figma.com'))         return { icon: 'bi-pentagon',    color: '#a259ff', label: 'Figma' };
    if (host.includes('airtable.com'))      return { icon: 'bi-table',       color: '#ffb100', label: 'Airtable' };
    if (host.includes('youtube.com') || host.includes('youtu.be')) return { icon: 'bi-youtube',      color: '#ff0000', label: 'YouTube' };
    if (host.includes('dropbox.com'))       return { icon: 'bi-dropbox',     color: '#0061ff', label: 'Dropbox' };
    if (host.includes('github.com'))        return { icon: 'bi-github',      color: '#181717', label: 'GitHub' };
    if (path.endsWith('.pdf'))              return { icon: 'bi-file-earmark-pdf', color: '#d93025', label: 'PDF' };
    return { icon: 'bi-link-45deg', color: '#2563eb', label: host };
  } catch {
    return { icon: 'bi-link-45deg', color: '#2563eb', label: 'Link' };
  }
}
