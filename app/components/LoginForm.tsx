'use client';

import {useActionState} from 'react';
import {signIn, type ActionResult} from '@/app/actions';
import Seal from '@/components/Seal';
import ThemeToggle from '@/components/ThemeToggle';

const initialState: ActionResult = {error: null};

/**
 * メール + パスワードのログインフォーム。
 * サインアップは提供しない（ユーザー作成は Supabase ダッシュボードで行う想定）。
 */
export default function LoginForm() {
  const [state, formAction, pending] = useActionState(signIn, initialState);

  return (
    <main className="relative flex min-h-dvh flex-col overflow-hidden">
      {/* 画面の奥に沈めた特大の「栞」。読ませる文字ではないので支援技術からは隠す。 */}
      <span
        aria-hidden="true"
        className="pointer-events-none absolute -right-[8vw] top-1/2 -translate-y-1/2 select-none font-display text-[46vw] leading-none text-text/[0.025] lg:text-[34vw]"
      >
        栞
      </span>

      <div className="relative mx-auto grid w-full max-w-6xl flex-1 items-center gap-16 px-6 py-16 lg:grid-cols-[1fr_auto] lg:gap-24 lg:px-10">
        <section className="max-w-md">
          <p className="kicker animate-rise">Private Archive — 栞</p>

          <div className="mt-8 animate-seal">
            <Seal size={64} />
          </div>

          <h1 className="mt-8 animate-rise font-display text-[42px] font-semibold leading-[1.15] tracking-[0.02em] [animation-delay:120ms] sm:text-[52px]">
            集めたページを、
            <br />
            <span className="text-shu-lit">書架</span>に納める。
          </h1>

          <div className="mt-8 h-px w-full origin-left animate-draw bg-line [animation-delay:320ms]" />

          <p className="mt-8 animate-rise text-[13px] leading-[2] text-dim [animation-delay:240ms]">
            評価・タグ・サムネイルでWebサイトを束ねる、
            <br className="hidden sm:block" />
            ひとりぶんのブックマーク書庫です。
          </p>
        </section>

        <section className="w-full animate-rise lg:w-[380px] [animation-delay:360ms]">
          <div className="border border-line bg-panel/70 p-8 backdrop-blur-sm sm:p-10">
            <h2 className="rule-shu font-display text-xl font-semibold tracking-[0.08em]">ログイン</h2>

            <form action={formAction} className="mt-8 flex flex-col gap-6">
              <label className="block">
                <span className="kicker">Mail</span>
                <input
                  type="email"
                  name="email"
                  autoComplete="email"
                  required
                  placeholder="you@example.com"
                  aria-invalid={state.error ? true : undefined}
                  className={`field mt-2.5 ${state.error ? 'field-error' : ''}`}
                />
              </label>

              <label className="block">
                <span className="kicker">Password</span>
                <input
                  type="password"
                  name="password"
                  autoComplete="current-password"
                  required
                  placeholder="••••••••"
                  aria-invalid={state.error ? true : undefined}
                  className={`field mt-2.5 ${state.error ? 'field-error' : ''}`}
                />
              </label>

              {state.error && (
                <p role="alert" className="notice notice-error">
                  {state.error}
                </p>
              )}

              <button type="submit" disabled={pending} className="btn btn-shu mt-2 w-full">
                {pending ? (
                  <>
                    <span className="h-1.5 w-1.5 animate-pulse-shu bg-white" />
                    照合中
                  </>
                ) : (
                  '書架をひらく'
                )}
              </button>
            </form>
          </div>

          <p className="kicker mt-6 text-center">Accounts are provisioned manually</p>
        </section>
      </div>

      <footer className="relative border-t border-line-soft px-6 py-5 lg:px-10">
        <div className="mx-auto flex max-w-6xl items-center justify-between gap-4">
          <p className="kicker">Webサイトブックマーク</p>
          <ThemeToggle />
        </div>
      </footer>
    </main>
  );
}
