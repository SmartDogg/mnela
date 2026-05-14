import { redirect } from 'next/navigation';

// /search was replaced by the unified Cmd-K palette over documents +
// entities in ADR-0052. Bookmarks land on the dashboard so the user can
// open the palette themselves.
export default function SearchRedirect(): never {
  redirect('/');
}
