// Conta Puter: login (popup do puter.com) e o perfil guardado no puter.kv.
// O script vem de https://js.puter.com/v2/ (index.html); aqui só o que usamos.

import type { Profile } from "../core/types";

interface PuterUser {
  username: string;
  uuid?: string;
}

interface PuterJs {
  quiet?: boolean;
  auth: {
    signIn(opts?: { attempt_temp_user_creation?: boolean }): Promise<unknown>;
    signOut(): void;
    isSignedIn(): boolean;
    getUser(): Promise<PuterUser>;
  };
  kv: {
    get(key: string): Promise<unknown>;
    set(key: string, value: string): Promise<unknown>;
  };
}

declare global {
  interface Window {
    puter?: PuterJs;
  }
}

const PROFILE_KEY = "open-eddy:profile";

/** Espera o script do Puter carregar (ou falha se não houver internet). */
export async function puterReady(timeoutMs = 12000): Promise<PuterJs> {
  const t0 = Date.now();
  while (!window.puter) {
    if (Date.now() - t0 > timeoutMs) throw new Error("não consegui carregar o Puter (sem internet?)");
    await new Promise((r) => setTimeout(r, 100));
  }
  window.puter.quiet = true; // sem propaganda no console
  return window.puter;
}

export async function currentUser(): Promise<PuterUser | null> {
  const p = await puterReady();
  if (!p.auth.isSignedIn()) return null;
  try {
    return await p.auth.getUser();
  } catch {
    return null;
  }
}

/** Tem que vir de um clique: o Puter abre um popup. */
export async function signIn(): Promise<PuterUser> {
  const p = await puterReady();
  try {
    await p.auth.signIn();
  } catch (e) {
    const err = e as { error?: string; msg?: string };
    if (err?.error === "auth_window_closed") throw new Error("Você fechou a janela do Puter antes de entrar.");
    if (err?.error === "popup_blocked") throw new Error("O popup do Puter foi bloqueado.");
    throw new Error(err?.msg ?? String(e));
  }
  return p.auth.getUser();
}

export async function signOut() {
  (await puterReady()).auth.signOut();
}

export async function loadProfile(): Promise<Profile | null> {
  const raw = await (await puterReady()).kv.get(PROFILE_KEY);
  if (!raw) return null;
  try {
    const p = JSON.parse(String(raw)) as Profile;
    return p.nome ? p : null;
  } catch {
    return null;
  }
}

export async function saveProfile(p: Profile) {
  await (await puterReady()).kv.set(PROFILE_KEY, JSON.stringify(p));
}
