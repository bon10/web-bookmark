'use client';

import {useActionState} from 'react';
import {signIn, type ActionResult} from '@/app/actions';

const initialState: ActionResult = {error: null};

/**
 * メール + パスワードのログインフォーム。
 * サインアップは提供しない（ユーザー作成は Supabase ダッシュボードで行う想定）。
 */
export default function LoginForm() {
  const [state, formAction, pending] = useActionState(signIn, initialState);

  return (
    <main className="mx-auto mt-16 max-w-sm px-4">
      <h1 className="mb-6 text-2xl font-semibold">ログイン</h1>
      <form action={formAction} className="flex flex-col space-y-4">
        <input
          type="email"
          name="email"
          autoComplete="email"
          required
          placeholder="メールアドレス"
          className="rounded border border-gray-300 p-2"
        />
        <input
          type="password"
          name="password"
          autoComplete="current-password"
          required
          placeholder="パスワード"
          className="rounded border border-gray-300 p-2"
        />
        {state.error && (
          <p role="alert" className="text-sm text-red-600">
            {state.error}
          </p>
        )}
        <button
          type="submit"
          disabled={pending}
          className="rounded bg-blue-500 py-2 px-4 text-white disabled:opacity-50"
        >
          {pending ? 'ログイン中…' : 'ログイン'}
        </button>
      </form>
    </main>
  );
}
