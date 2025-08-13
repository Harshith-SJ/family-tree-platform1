import { cookies } from 'next/headers';
import { redirect } from 'next/navigation';

export default function Home() {
  const token = cookies().get('token');
  if (token) {
    redirect('/families');
  }
  return (
    <main className="relative min-h-[calc(100dvh-3.5rem)] overflow-hidden">
      {/* Background */}
      <div className="absolute inset-0 -z-10 bg-gradient-to-br from-indigo-50 via-white to-sky-50" />
      <div className="pointer-events-none absolute -top-24 -left-24 h-72 w-72 rounded-full bg-indigo-200/30 blur-3xl" />
      <div className="pointer-events-none absolute -bottom-24 -right-24 h-72 w-72 rounded-full bg-sky-200/30 blur-3xl" />

      {/* Hero */}
      <section className="mx-auto max-w-5xl px-6 py-14 text-center">
        <h1 className="text-4xl sm:text-5xl font-semibold tracking-tight text-gray-900">Collaborative Family Trees</h1>
        <p className="mt-3 text-gray-600 text-base sm:text-lg">
          Build, edit, and explore your family tree together in real time.
        </p>
      </section>

      {/* Cards */}
      <section className="mx-auto max-w-5xl px-6 pb-16">
        <div className="grid gap-6 sm:grid-cols-2">
          <a href="/signup" className="group rounded-2xl border border-indigo-100 bg-white p-6 shadow-sm transition hover:shadow-md">
            <div className="flex items-start gap-4">
              <div className="grid h-10 w-10 place-items-center rounded-lg bg-indigo-100 text-indigo-700 text-lg">✳️</div>
              <div>
                <h3 className="font-medium text-gray-900 group-hover:text-indigo-700">Create an account</h3>
                <p className="mt-1 text-sm text-gray-600">Get started and invite your family members.</p>
              </div>
            </div>
            <div className="mt-4 inline-flex items-center gap-2 text-sm text-indigo-700">Sign up<span>→</span></div>
          </a>

          <a href="/login" className="group rounded-2xl border border-emerald-100 bg-white p-6 shadow-sm transition hover:shadow-md">
            <div className="flex items-start gap-4">
              <div className="grid h-10 w-10 place-items-center rounded-lg bg-emerald-100 text-emerald-700 text-lg">🔐</div>
              <div>
                <h3 className="font-medium text-gray-900 group-hover:text-emerald-700">Return to your tree</h3>
                <p className="mt-1 text-sm text-gray-600">Log in to continue collaborating.</p>
              </div>
            </div>
            <div className="mt-4 inline-flex items-center gap-2 text-sm text-emerald-700">Log in<span>→</span></div>
          </a>
        </div>
      </section>
    </main>
  );
}
