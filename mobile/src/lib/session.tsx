import React, {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useRef,
  useState,
} from "react";
import { AppState, Platform } from "react-native";
import * as SecureStore from "expo-secure-store";
import { ApiError, normalizeOrigin, request } from "./api";
import { Catalog, Portal, User, Workspace } from "./types";

type Saved = { origin: string; token: string | null };
const storageKey = "chairside.connection.v1";
// Web preview keeps credentials in memory only. Native uses Keychain/Keystore.
async function save(value: Saved) {
  if (Platform.OS !== "web")
    await SecureStore.setItemAsync(storageKey, JSON.stringify(value), {
      keychainAccessible: SecureStore.WHEN_UNLOCKED_THIS_DEVICE_ONLY,
    });
}
function useModel() {
  const initial = process.env.EXPO_PUBLIC_API_URL || "";
  const [origin, setOrigin] = useState(initial);
  const [token, setToken] = useState<string | null>(null);
  const [user, setUser] = useState<User | null>(null);
  const [catalog, setCatalog] = useState<Catalog | null>(null);
  const [portal, setPortal] = useState<Portal | null>(null);
  const [workspace, setWorkspace] = useState<Workspace | null>(null);
  const [ready, setReady] = useState(false);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const generation = useRef(0);
  const current = useRef({ origin, token });
  const [now, setNow] = useState(() => Date.now());
  const clearIdentity = useCallback(async (base: string) => {
    current.current = { origin: base, token: null };
    setToken(null);
    setUser(null);
    setPortal(null);
    setWorkspace(null);
    await save({ origin: base, token: null });
  }, []);
  const api = useCallback(
    async <T,>(
      path: string,
      method = "GET",
      body?: unknown,
      key?: string,
    ): Promise<T> => {
      const connection = current.current;
      try {
        return await request<T>(
          connection.origin,
          connection.token,
          path,
          method,
          body,
          key,
        );
      } catch (e) {
        if (
          e instanceof ApiError &&
          e.status === 401 &&
          connection.token &&
          current.current.token === connection.token
        ) {
          generation.current++;
          await clearIdentity(connection.origin);
        }
        throw e;
      }
    },
    [clearIdentity],
  );
  const refresh = useCallback(
    async (
      base = current.current.origin,
      credential = current.current.token,
    ) => {
      const run = ++generation.current;
      if (!base) {
        setReady(true);
        return;
      }
      setLoading(true);
      setError("");
      try {
        const [nextCatalog, nextUser] = await Promise.all([
          request<Catalog>(base, null, "/public/catalog"),
          credential
            ? request<User>(base, credential, "/account")
            : Promise.resolve(null),
        ]);
        const nextPortal =
          nextUser?.role === "customer"
            ? await request<Portal>(base, credential, "/portal")
            : null;
        const nextWorkspace =
          nextUser && nextUser.role !== "customer"
            ? await request<Workspace>(base, credential, "/data")
            : null;
        if (run !== generation.current) return;
        setNow(Date.now());
        setCatalog(nextCatalog);
        setUser(nextUser);
        setPortal(nextPortal);
        setWorkspace(nextWorkspace);
      } catch (e) {
        if (run !== generation.current) return;
        if (e instanceof ApiError && e.status === 401)
          await clearIdentity(base);
        setError(e instanceof Error ? e.message : "Unable to refresh.");
      } finally {
        if (run === generation.current) {
          setLoading(false);
          setReady(true);
        }
      }
    },
    [clearIdentity],
  );
  useEffect(() => {
    let active = true;
    (async () => {
      try {
        const raw =
          Platform.OS !== "web"
            ? await SecureStore.getItemAsync(storageKey)
            : null;
        const stored: Saved = raw
          ? JSON.parse(raw)
          : { origin: initial, token: null };
        const base = stored.origin
          ? normalizeOrigin(
              stored.origin,
              __DEV__ ||
                (Platform.OS === "web" &&
                  process.env.EXPO_PUBLIC_LOCAL_PREVIEW === "true"),
            )
          : "";
        if (!active) return;
        setOrigin(base);
        setToken(stored.token);
        current.current = { origin: base, token: stored.token };
        await refresh(base, stored.token);
      } catch {
        if (active) {
          setError(
            "Saved connection could not be restored. Reconnect to your studio.",
          );
          setReady(true);
        }
      }
    })();
    return () => {
      active = false;
      // Invalidate requests; this counter is not a DOM ref.
      // eslint-disable-next-line react-hooks/exhaustive-deps
      generation.current++;
    };
    // Restore once; subsequent changes are explicitly persisted.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
  useEffect(() => {
    const sub = AppState.addEventListener("change", (state) => {
      if (state === "active") void refresh();
    });
    return () => sub.remove();
  }, []); // eslint-disable-line react-hooks/exhaustive-deps
  async function connect(value: string) {
    const base = normalizeOrigin(
      value,
      __DEV__ ||
        (Platform.OS === "web" &&
          process.env.EXPO_PUBLIC_LOCAL_PREVIEW === "true"),
    );
    const health = await request<{ status: string }>(base, null, "/health");
    if (health.status !== "ok") throw Error("The studio is not ready.");
    if (current.current.token)
      await request(
        current.current.origin,
        current.current.token,
        "/logout",
        "POST",
        {},
      );
    generation.current++;
    await save({ origin: base, token: null });
    current.current = { origin: base, token: null };
    setOrigin(base);
    setToken(null);
    setUser(null);
    setPortal(null);
    setWorkspace(null);
    setCatalog(null);
    await refresh(base, null);
  }
  async function login(email: string, password: string, code: string) {
    const result = await api<{ token: string }>("/mobile/login", "POST", {
      email: email.trim(),
      password,
      code,
    });
    await save({ origin, token: result.token });
    setToken(result.token);
    current.current = { origin, token: result.token };
    await refresh(origin, result.token);
  }
  async function logout() {
    await api("/logout", "POST", {});
    generation.current++;
    current.current = { origin, token: null };
    await clearIdentity(origin);
    setLoading(false);
    setError("");
  }
  return {
    origin,
    now,
    user,
    catalog,
    portal,
    workspace,
    ready,
    loading,
    error,
    refresh: () => refresh(),
    api,
    connect,
    login,
    logout,
    staff: !!user && user.role !== "customer",
    operator:
      !!user && ["owner", "manager", "receptionist"].includes(user.role),
  };
}
type Model = ReturnType<typeof useModel>;
const Context = createContext<Model | null>(null);
export function SessionProvider({ children }: { children: React.ReactNode }) {
  const model = useModel();
  return <Context.Provider value={model}>{children}</Context.Provider>;
}
export function useSession() {
  const value = useContext(Context);
  if (!value) throw Error("Session provider missing");
  return value;
}
