'use client';
import { useEffect, useMemo, useState } from 'react';
import { useForm } from 'react-hook-form';
import { z } from 'zod';
import { zodResolver } from '@hookform/resolvers/zod';
import { useRouter } from 'next/navigation';
import { api } from '@/lib/api';

const schema = z.object({
  name: z.string().min(2),
  email: z.string().email(),
  password: z.string().min(8),
  confirmPassword: z.string().min(8),
  gender: z.enum(['MALE', 'FEMALE', 'OTHER']).optional(),
  birthDate: z.string().optional(),
  familyName: z.string().min(2).optional(),
}).refine((data) => data.password === data.confirmPassword, {
  message: "Passwords do not match",
  path: ["confirmPassword"],
});

type FormData = z.infer<typeof schema>;

export default function SignupPage() {
  const { register, handleSubmit, watch, formState: { errors, isSubmitting, isValid } } = useForm<FormData>({
    resolver: zodResolver(schema),
    mode: 'onChange',
  });
  const router = useRouter();
  const [errorMsg, setErrorMsg] = useState<string | null>(null);
  const [showPw, setShowPw] = useState(false);
  const [showPw2, setShowPw2] = useState(false);

  useEffect(() => {
    // If already authenticated, skip signup
    (async () => {
      try {
        await api('/auth/me');
        router.replace('/families');
      } catch {}
    })();
  }, [router]);

  const pw = watch('password');
  const pwScore = useMemo(() => {
    let score = 0;
    if (!pw) return 0;
    if (pw.length >= 8) score++;
    if (/[A-Z]/.test(pw)) score++;
    if (/[a-z]/.test(pw)) score++;
    if (/\d/.test(pw)) score++;
    if (/[^A-Za-z0-9]/.test(pw)) score++;
    return Math.min(score, 5);
  }, [pw]);

  async function onSubmit(data: FormData) {
    try {
      setErrorMsg(null);
      const { confirmPassword, ...payload } = data;
      await api('/auth/signup', { method: 'POST', body: JSON.stringify(payload) });
      router.push('/families');
    } catch (e) {
      setErrorMsg('Signup failed. Please check your details and try again.');
    }
  }

  return (
    <main className="relative min-h-[calc(100dvh-3.5rem)]">
      <div className="absolute inset-0 -z-10 bg-gradient-to-br from-indigo-50 via-white to-sky-50" />
      <section className="mx-auto max-w-md px-6 py-10">
        <div className="rounded-2xl border border-slate-200 bg-white p-6 shadow-sm">
          <h1 className="text-2xl font-semibold">Create your account</h1>
          <p className="mt-1 text-sm text-slate-600">Start collaborating on your family tree in minutes.</p>
          {errorMsg && <div className="mt-3 rounded-md border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-700">{errorMsg}</div>}
          <form onSubmit={handleSubmit(onSubmit)} className="mt-5 space-y-4">
        <div>
          <label className="block text-sm mb-1">Full Name</label>
          <input className="w-full border rounded px-3 py-2" autoComplete="name" {...register('name')} />
          {errors.name && <p className="text-sm text-red-600">{errors.name.message}</p>}
        </div>
        <div>
          <label className="block text-sm mb-1">Email</label>
          <input className="w-full border rounded px-3 py-2" type="email" autoComplete="email" {...register('email')} />
          {errors.email && <p className="text-sm text-red-600">{errors.email.message}</p>}
        </div>
        <div>
          <label className="block text-sm mb-1">Password</label>
          <div className="relative">
            <input className="w-full border rounded px-3 py-2 pr-12" type={showPw ? 'text' : 'password'} autoComplete="new-password" {...register('password')} />
            <button type="button" className="absolute inset-y-0 right-0 my-1 mr-1 rounded px-2 text-sm text-slate-600 hover:bg-slate-100" onClick={() => setShowPw((s) => !s)}>
              {showPw ? 'Hide' : 'Show'}
            </button>
          </div>
          {errors.password && <p className="text-sm text-red-600">{errors.password.message}</p>}
          <div className="mt-2">
            <div className="h-1.5 w-full overflow-hidden rounded bg-slate-100">
              <div className={[
                'h-1.5 transition-all',
                pwScore <= 2 ? 'bg-red-400' : pwScore === 3 ? 'bg-amber-400' : 'bg-emerald-500',
              ].join(' ')} style={{ width: `${(pwScore / 5) * 100}%` }} />
            </div>
            <div className="mt-1 text-xs text-slate-500">Use 8+ characters with a mix of letters, numbers, and symbols.</div>
          </div>
        </div>
        <div>
          <label className="block text-sm mb-1">Confirm Password</label>
          <div className="relative">
            <input className="w-full border rounded px-3 py-2 pr-12" type={showPw2 ? 'text' : 'password'} autoComplete="new-password" {...register('confirmPassword')} />
            <button type="button" className="absolute inset-y-0 right-0 my-1 mr-1 rounded px-2 text-sm text-slate-600 hover:bg-slate-100" onClick={() => setShowPw2((s) => !s)}>
              {showPw2 ? 'Hide' : 'Show'}
            </button>
          </div>
          {errors.confirmPassword && <p className="text-sm text-red-600">{errors.confirmPassword.message}</p>}
        </div>
        <div className="grid grid-cols-2 gap-2">
          <div>
            <label className="block text-sm mb-1">Gender</label>
            <select className="w-full border rounded px-3 py-2" {...register('gender')}>
              <option value="">Select</option>
              <option value="MALE">Male</option>
              <option value="FEMALE">Female</option>
              <option value="OTHER">Other</option>
            </select>
            {errors.gender && <p className="text-sm text-red-600">{errors.gender.message}</p>}
          </div>
          <div>
            <label className="block text-sm mb-1">Birth date</label>
            <input className="w-full border rounded px-3 py-2" type="date" {...register('birthDate')} />
          </div>
        </div>
        <div>
          <label className="block text-sm mb-1">Initial family name (optional)</label>
          <input className="w-full border rounded px-3 py-2" {...register('familyName')} />
        </div>
        <button disabled={isSubmitting || !isValid} className="w-full rounded-md bg-indigo-600 px-4 py-2 font-medium text-white hover:bg-indigo-700 disabled:opacity-50 disabled:cursor-not-allowed">{isSubmitting ? 'Creating...' : 'Sign up'}</button>
        <div className="text-center text-sm text-slate-600">Already have an account? <a href="/login" className="text-indigo-700 hover:underline">Log in</a></div>
          </form>
        </div>
      </section>
    </main>
  );
}
