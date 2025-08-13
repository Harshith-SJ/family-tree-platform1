"use client";
import { useEffect, useState } from "react";
import { api } from "@/lib/api";
import { toast } from "@/lib/toast";

type Profile = {
  id: string;
  name: string;
  email: string;
  gender?: 'MALE' | 'FEMALE' | 'OTHER' | null;
  birthDate?: string | null;
};

export default function ProfilePage() {
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [pwdSaving, setPwdSaving] = useState(false);
  const [data, setData] = useState<Profile | null>(null);

  const [name, setName] = useState("");
  const [gender, setGender] = useState<Profile['gender']>(null);
  const [birthDate, setBirthDate] = useState("");

  const [currentPassword, setCurrentPassword] = useState("");
  const [newPassword, setNewPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");

  useEffect(() => {
    (async () => {
      try {
        const res = await api<{ user: { sub: string; email: string } }>("/auth/me");
        // ok
      } catch {
        window.location.href = "/login";
        return;
      }
      try {
        const res = await api<{ user: Profile }>("/profile");
        setData(res.user);
        setName(res.user.name || "");
        setGender((res.user.gender as any) ?? null);
        setBirthDate(res.user.birthDate || "");
      } catch (e) {
        toast.error("Failed to load profile");
      } finally {
        setLoading(false);
      }
    })();
  }, []);

  async function saveProfile(e: React.FormEvent) {
    e.preventDefault();
    setSaving(true);
    try {
      const res = await api<{ user: Profile }>("/profile", {
        method: "PATCH",
        body: JSON.stringify({ name, gender, birthDate: birthDate || undefined }),
        headers: { "Content-Type": "application/json" },
      });
      setData(res.user);
      toast.success("Profile updated");
    } catch {
      toast.error("Could not save profile");
    } finally {
      setSaving(false);
    }
  }

  async function changePassword(e: React.FormEvent) {
    e.preventDefault();
    if (newPassword.length < 8) {
      toast.error("New password must be at least 8 characters");
      return;
    }
    if (newPassword !== confirmPassword) {
      toast.error("Passwords do not match");
      return;
    }
    setPwdSaving(true);
    try {
      await api("/profile/password", {
        method: "POST",
        body: JSON.stringify({ currentPassword, newPassword }),
        headers: { "Content-Type": "application/json" },
      });
      toast.success("Password changed");
      setCurrentPassword("");
      setNewPassword("");
      setConfirmPassword("");
    } catch {
      toast.error("Failed to change password");
    } finally {
      setPwdSaving(false);
    }
  }

  if (loading) return <div className="mx-auto max-w-4xl p-6">Loading…</div>;

  return (
    <div className="mx-auto max-w-4xl p-6">
      <h1 className="text-xl font-semibold text-slate-900 mb-4">Your Profile</h1>

      <div className="grid md:grid-cols-2 gap-6">
        <form onSubmit={saveProfile} className="rounded-lg border border-slate-200 p-4 bg-white">
          <h2 className="font-medium text-slate-800 mb-3">Profile details</h2>
          <div className="space-y-3">
            <div>
              <label className="block text-sm text-slate-600 mb-1">Email</label>
              <input disabled value={data?.email || ""} className="w-full rounded-md border border-slate-300 bg-slate-50 px-3 py-2 text-sm" />
            </div>
            <div>
              <label className="block text-sm text-slate-600 mb-1">Name</label>
              <input value={name} onChange={(e)=>setName(e.target.value)} className="w-full rounded-md border border-slate-300 px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-indigo-500" />
            </div>
            <div>
              <label className="block text-sm text-slate-600 mb-1">Gender</label>
              <select value={gender ?? ''} onChange={(e)=>setGender((e.target.value || null) as any)} className="w-full rounded-md border border-slate-300 px-3 py-2 text-sm">
                <option value="">Not set</option>
                <option value="MALE">Male</option>
                <option value="FEMALE">Female</option>
                <option value="OTHER">Other</option>
              </select>
            </div>
            <div>
              <label className="block text-sm text-slate-600 mb-1">Birth date</label>
              <input type="date" value={birthDate} onChange={(e)=>setBirthDate(e.target.value)} className="w-full rounded-md border border-slate-300 px-3 py-2 text-sm" />
            </div>
          </div>
          <div className="mt-4 flex justify-end">
            <button disabled={saving} className="px-3 py-1.5 rounded-md bg-indigo-600 text-white hover:bg-indigo-700 disabled:opacity-50">{saving ? 'Saving…' : 'Save changes'}</button>
          </div>
        </form>

        <form onSubmit={changePassword} className="rounded-lg border border-slate-200 p-4 bg-white">
          <h2 className="font-medium text-slate-800 mb-3">Change password</h2>
          <div className="space-y-3">
            <div>
              <label className="block text-sm text-slate-600 mb-1">Current password</label>
              <input type="password" value={currentPassword} onChange={(e)=>setCurrentPassword(e.target.value)} className="w-full rounded-md border border-slate-300 px-3 py-2 text-sm" />
            </div>
            <div>
              <label className="block text-sm text-slate-600 mb-1">New password</label>
              <input type="password" value={newPassword} onChange={(e)=>setNewPassword(e.target.value)} className="w-full rounded-md border border-slate-300 px-3 py-2 text-sm" />
            </div>
            <div>
              <label className="block text-sm text-slate-600 mb-1">Confirm new password</label>
              <input type="password" value={confirmPassword} onChange={(e)=>setConfirmPassword(e.target.value)} className="w-full rounded-md border border-slate-300 px-3 py-2 text-sm" />
            </div>
          </div>
          <div className="mt-4 flex justify-end">
            <button disabled={pwdSaving} className="px-3 py-1.5 rounded-md bg-sky-600 text-white hover:bg-sky-700 disabled:opacity-50">{pwdSaving ? 'Updating…' : 'Update password'}</button>
          </div>
        </form>
      </div>

      <div className="mt-8 text-xs text-slate-500">
        Future: Allow family members to view your node details here.
      </div>
    </div>
  );
}
