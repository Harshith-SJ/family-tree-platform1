"use client";
export default function RedirectToFamilyChat() {
  if (typeof window !== 'undefined') {
    const fid = sessionStorage.getItem('familyId');
    if (fid) window.location.replace(`/families/${fid}/chat`);
    else window.location.replace('/families');
  }
  return null;
}
