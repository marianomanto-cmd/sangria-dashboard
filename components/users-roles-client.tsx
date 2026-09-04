"use client";

import { useState, useTransition } from "react";
import { Plus, UserPlus, X } from "lucide-react";
import { Button } from "@/components/button";
import { useToast } from "@/components/toast";
import {
  ROLE_META,
  ROLE_VALUES,
  type AppUserRole,
  type AppUserRow,
} from "@/lib/roles";
import {
  addUserByEmail,
  setUserActive,
  setUserRole,
} from "@/app/actions/app-users";

function formatDate(iso: string | null): string {
  if (!iso) return "—";
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return "—";
  return d.toLocaleDateString("es-AR", {
    day: "2-digit",
    month: "short",
    year: "numeric",
  });
}

export function UsersRolesClient({
  users,
  currentEmail,
}: {
  users: AppUserRow[];
  currentEmail: string | null;
}) {
  const toast = useToast();
  const [pending, startTransition] = useTransition();
  const [adding, setAdding] = useState(false);
  const [form, setForm] = useState({ email: "", name: "", role: "viewer" });

  function run(fn: () => Promise<{ ok: boolean; error?: string }>, okMsg: string) {
    startTransition(async () => {
      const res = await fn();
      if (res.ok) toast.success(okMsg);
      else toast.error(res.error ?? "No se pudo guardar.");
    });
  }

  return (
    <div className="space-y-5">
      <div className="flex items-start justify-between gap-4 flex-wrap">
        <p className="text-[13px] text-muted max-w-2xl leading-relaxed">
          Quien entra a la app queda listado acá automáticamente con rol{" "}
          <strong className="text-ink-2">Viewer</strong>. Cambiale el rol para
          darle permisos. También podés cargar a alguien por email antes de su
          primer ingreso.
        </p>
        <Button
          variant="secondary"
          size="sm"
          onClick={() => setAdding((v) => !v)}
        >
          {adding ? <X size={14} /> : <UserPlus size={14} />}
          {adding ? "Cancelar" : "Agregar por email"}
        </Button>
      </div>

      {adding && (
        <form
          data-audit-hint="addUserByEmail"
          className="rounded-lg border border-line bg-white dark:bg-paper-2 p-4 flex flex-wrap items-end gap-3"
          onSubmit={(e) => {
            e.preventDefault();
            run(
              () => addUserByEmail(form),
              `${form.email} agregado como ${ROLE_META[form.role as AppUserRole].label}.`,
            );
            setForm({ email: "", name: "", role: "viewer" });
            setAdding(false);
          }}
        >
          <label className="flex flex-col gap-1 min-w-[240px] flex-1">
            <span className="text-[11px] uppercase tracking-[0.08em] text-muted font-medium">
              Email
            </span>
            <input
              type="email"
              required
              value={form.email}
              onChange={(e) => setForm({ ...form, email: e.target.value })}
              placeholder="nombre@sangria.agency"
              className="rounded-md border border-line bg-white dark:bg-paper px-3 py-1.5 text-sm text-ink"
            />
          </label>
          <label className="flex flex-col gap-1 min-w-[180px] flex-1">
            <span className="text-[11px] uppercase tracking-[0.08em] text-muted font-medium">
              Nombre (opcional)
            </span>
            <input
              value={form.name}
              onChange={(e) => setForm({ ...form, name: e.target.value })}
              className="rounded-md border border-line bg-white dark:bg-paper px-3 py-1.5 text-sm text-ink"
            />
          </label>
          <label className="flex flex-col gap-1 min-w-[160px]">
            <span className="text-[11px] uppercase tracking-[0.08em] text-muted font-medium">
              Rol
            </span>
            <select
              value={form.role}
              onChange={(e) => setForm({ ...form, role: e.target.value })}
              className="rounded-md border border-line bg-white dark:bg-paper px-3 py-1.5 text-sm text-ink"
            >
              {ROLE_VALUES.map((r) => (
                <option key={r} value={r}>
                  {ROLE_META[r].label}
                </option>
              ))}
            </select>
          </label>
          <Button type="submit" size="md" disabled={pending}>
            <Plus size={14} />
            Agregar
          </Button>
        </form>
      )}

      <div className="rounded-lg border border-line overflow-hidden">
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead className="bg-paper-2 text-[11px] uppercase tracking-[0.08em] text-muted">
              <tr>
                <th className="text-left font-medium px-4 py-2.5">Usuario</th>
                <th className="text-left font-medium px-4 py-2.5">Rol</th>
                <th className="text-left font-medium px-4 py-2.5">
                  Último ingreso
                </th>
                <th className="text-right font-medium px-4 py-2.5">Estado</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-line">
              {users.length === 0 && (
                <tr>
                  <td colSpan={4} className="px-4 py-8 text-center text-muted">
                    Todavía no entró nadie.
                  </td>
                </tr>
              )}
              {users.map((u) => {
                const isMe = currentEmail?.toLowerCase() === u.email;
                return (
                  <tr
                    key={u.id}
                    className={u.active ? "bg-white dark:bg-paper-2" : "bg-paper-2/60"}
                  >
                    <td className="px-4 py-3">
                      <div className="font-medium text-ink">
                        {u.name ?? u.email.split("@")[0]}
                        {isMe && (
                          <span className="ml-2 text-[10px] uppercase tracking-[0.08em] text-muted">
                            vos
                          </span>
                        )}
                      </div>
                      <div className="text-xs text-muted">{u.email}</div>
                    </td>
                    <td className="px-4 py-3">
                      <select
                        data-audit-hint="setUserRole"
                        value={u.role}
                        disabled={pending}
                        onChange={(e) =>
                          run(
                            () =>
                              setUserRole({
                                userId: u.id,
                                role: e.target.value,
                              }),
                            `${u.email} ahora es ${
                              ROLE_META[e.target.value as AppUserRole].label
                            }.`,
                          )
                        }
                        className="rounded-md border border-line bg-white dark:bg-paper px-2.5 py-1 text-xs text-ink"
                      >
                        {ROLE_VALUES.map((r) => (
                          <option key={r} value={r}>
                            {ROLE_META[r].label}
                          </option>
                        ))}
                      </select>
                      <p className="text-[11px] text-muted mt-1 max-w-[280px]">
                        {ROLE_META[u.role].description}
                      </p>
                    </td>
                    <td className="px-4 py-3 text-xs text-muted whitespace-nowrap">
                      {formatDate(u.lastSeenAt)}
                    </td>
                    <td className="px-4 py-3 text-right">
                      <Button
                        data-audit-hint="setUserActive"
                        variant={u.active ? "ghost" : "secondary"}
                        size="xs"
                        disabled={pending || isMe}
                        onClick={() =>
                          run(
                            () =>
                              setUserActive({
                                userId: u.id,
                                active: !u.active,
                              }),
                            u.active
                              ? `${u.email} desactivado.`
                              : `${u.email} reactivado.`,
                          )
                        }
                      >
                        {u.active ? "Desactivar" : "Reactivar"}
                      </Button>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      </div>

      <div className="rounded-lg border border-line bg-paper-2 px-5 py-4">
        <h3 className="text-xs uppercase tracking-[0.08em] text-muted font-medium">
          Qué hace cada rol
        </h3>
        <dl className="mt-3 grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-x-6 gap-y-2">
          {ROLE_VALUES.map((r) => (
            <div key={r} className="text-[13px]">
              <dt className="font-medium text-ink">{ROLE_META[r].label}</dt>
              <dd className="text-muted text-xs">{ROLE_META[r].description}</dd>
            </div>
          ))}
        </dl>
        <p className="mt-3 text-[11px] text-muted leading-relaxed">
          Hoy el rol gobierna la aprobación de planes (Admin y Aprobador) y el
          acceso a esta sección (Admin). El resto de los roles queda registrado
          para cuando se restrinja cada área.
        </p>
      </div>
    </div>
  );
}
