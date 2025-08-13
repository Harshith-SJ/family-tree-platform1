export default function RedirectToFamilies() {
  if (typeof window !== 'undefined') {
    const fid = sessionStorage.getItem('familyId');
    if (fid) window.location.replace(`/families/${fid}/tree`);
    else window.location.replace('/families');
  }
  return null;
}
