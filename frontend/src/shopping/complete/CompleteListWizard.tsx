import { useEffect, useRef, useState, type FormEvent, type ReactNode } from 'react'
import { Link, useNavigate } from 'react-router-dom'
import { useCompleteShoppingList, useIsCompletingShoppingList } from '@/api/hooks/useShoppingLists'
import type { Member, ShoppingList } from '@/api/types'
import { UNIT_SHORT_LABELS } from '@/catalog/units'
import { Button } from '@/components/ui/button'
import { todayIso } from '@/expenses/dates'
import { formatDecimal, normalizeDecimal } from '@/lib/decimal'
import { formatMinor, lineTotalMinor, minorToInputValue, parseMoneyToMinor } from '@/lib/money'
import { mapCompleteProblem, type CompleteProblem } from './problems'
import {
  buildRequest,
  stepForField,
  sumLinesMinor,
  validateStep,
  type FieldErrors,
  type ItemValues,
  type StepNumber,
  type WizardValues,
} from './schema'

const inputClass = 'h-10 w-full rounded-md border border-border bg-background px-3 text-sm'
const STEPS = ['Ítems', 'Datos de la compra', 'Pendientes'] as const

/** Estado que la página de la lista lee para mostrar el aviso de éxito. */
export interface PurchaseCompletedState {
  purchaseCompleted: { amountMinor: number; currency: string; leftoverListCreated: boolean }
}

const fieldId = (key: string) => `complete-${key.replaceAll('.', '-')}`

interface Props {
  list: ShoppingList
  currency: string
  timeZone?: string
  members: Member[]
  defaultPaidBy?: string
}

function initialValues(props: Props): WizardValues {
  const { list, currency, timeZone, members, defaultPaidBy } = props
  const activeDefault = members.some((m) => m.active && m.id === defaultPaidBy) ? defaultPaidBy : ''
  return {
    items: list.items
      .filter((i) => i.checked)
      .map<ItemValues>((i) => ({
        listItemId: i.id,
        productId: i.product.id,
        name: i.product.name,
        unit: i.unit,
        quantity: formatDecimal(i.quantity),
        unitPrice:
          i.estimatedPrice && i.estimatedPrice.currency === currency
            ? minorToInputValue(i.estimatedPrice.amountMinor, currency)
            : '',
        expiryDate: '',
      })),
    purchaseDate: todayIso(timeZone),
    store: '',
    paidBy: activeDefault ?? '',
    totalOverride: null,
    leftoverAction: 'NEW_LIST',
  }
}

function Field({
  name,
  label,
  error,
  children,
}: {
  name: string
  label: string
  error?: string
  children: (aria: Record<string, unknown>) => ReactNode
}) {
  const id = fieldId(name)
  return (
    <div className="flex min-w-0 flex-col gap-1">
      <label htmlFor={id} className="text-sm font-medium">
        {label}
      </label>
      {children({
        id,
        'aria-invalid': error ? true : undefined,
        'aria-describedby': error ? `${id}-error` : undefined,
      })}
      {error && (
        <p id={`${id}-error`} role="alert" className="text-sm text-red-600">
          {error}
        </p>
      )}
    </div>
  )
}

export function CompleteListWizard(props: Props) {
  const { list, currency, members } = props
  const navigate = useNavigate()
  const complete = useCompleteShoppingList(list.id)
  const completing = useIsCompletingShoppingList(list.id)
  const busy = complete.isPending || completing

  const [values, setValues] = useState<WizardValues>(() => initialValues(props))
  const [step, setStep] = useState<StepNumber>(1)
  const [errors, setErrors] = useState<FieldErrors>({})
  const [serverFields, setServerFields] = useState<FieldErrors>({})
  const [problem, setProblem] = useState<CompleteProblem | null>(null)
  const [focusTarget, setFocusTarget] = useState<{ id: string } | null>(null)
  const headingRef = useRef<HTMLHeadingElement>(null)
  const alertRef = useRef<HTMLDivElement>(null)
  const mounted = useRef(false)

  const unchecked = list.items.filter((i) => !i.checked)
  const sum = sumLinesMinor(values.items, currency)
  const totalText = values.totalOverride ?? (sum !== null ? minorToInputValue(sum, currency) : '')
  const fieldErrors: FieldErrors = { ...serverFields, ...errors }

  // Foco accesible: al cambiar de paso, al título del paso (no en el primer render).
  useEffect(() => {
    if (mounted.current) headingRef.current?.focus()
    mounted.current = true
  }, [step])
  useEffect(() => {
    if (focusTarget) document.getElementById(focusTarget.id)?.focus()
  }, [focusTarget])
  useEffect(() => {
    if (problem?.message) alertRef.current?.focus()
  }, [problem])

  function setItem(index: number, patch: Partial<ItemValues>, key: string) {
    setValues((v) => ({
      ...v,
      items: v.items.map((it, i) => (i === index ? { ...it, ...patch } : it)),
    }))
    clear(key)
  }
  function setField<K extends keyof WizardValues>(name: K, value: WizardValues[K]) {
    setValues((v) => ({ ...v, [name]: value }))
    clear(name)
  }
  function clear(key: string) {
    setProblem(null)
    setErrors((e) => (key in e ? omit(e, key) : e))
    setServerFields((e) => (key in e ? omit(e, key) : e))
  }

  function goTo(errs: FieldErrors) {
    const first = Object.keys(errs)[0]
    if (!first) return
    setStep(stepForField(first))
    setFocusTarget({ id: fieldId(first) })
  }

  function next() {
    const errs = validateStep(step, values, currency, totalText)
    setErrors(errs)
    const first = Object.keys(errs)[0]
    if (first) setFocusTarget({ id: fieldId(first) })
    else setStep((s) => (s < 3 ? ((s + 1) as StepNumber) : s))
  }

  function submit() {
    if (busy) return
    const request = buildRequest(values, currency, totalText)
    if (!request) {
      const all = {
        ...validateStep(1, values, currency, totalText),
        ...validateStep(2, values, currency, totalText),
        ...validateStep(3, values, currency, totalText),
      }
      setErrors(all)
      goTo(all)
      return
    }
    setProblem(null)
    complete.mutate(request, {
      onSuccess: (purchase) => {
        const state: PurchaseCompletedState = {
          purchaseCompleted: {
            amountMinor: purchase.total.amountMinor,
            currency: purchase.total.currency,
            leftoverListCreated: values.leftoverAction === 'NEW_LIST' && unchecked.length > 0,
          },
        }
        void navigate(`/listas/${list.id}`, { replace: true, state })
      },
      onError: (error) => {
        const mapped = mapCompleteProblem(
          error,
          'No pudimos registrar la compra. Intentá de nuevo.',
        )
        setProblem(mapped)
        setServerFields(mapped.fields)
        setErrors({})
        goTo(mapped.fields)
      },
    })
  }

  function onSubmit(event: FormEvent) {
    event.preventDefault()
    if (step < 3) next()
    else submit()
  }

  if (problem?.listNotOpen || problem?.notFound) {
    return (
      <section className="flex flex-col gap-3">
        <div ref={alertRef} tabIndex={-1} role="alert" className="text-sm text-red-600">
          <p className="font-medium">
            {problem.listNotOpen ? 'La lista ya no está abierta' : 'No encontramos la lista'}
          </p>
          <p>{problem.message}</p>
        </div>
        <div className="flex flex-wrap gap-3 text-sm">
          <Link to={problem.notFound ? '/listas' : `/listas/${list.id}`} className="underline">
            {problem.notFound ? 'Volver a las listas' : 'Volver a la lista'}
          </Link>
          {problem.listNotOpen && (
            <Link to="/gastos" className="underline">
              Ver gastos
            </Link>
          )}
        </div>
      </section>
    )
  }

  const totalMinor = parseMoneyToMinor(totalText, currency)

  return (
    <form onSubmit={onSubmit} noValidate className="flex flex-col gap-4">
      <div>
        <Link to={`/listas/${list.id}`} className="text-sm underline">
          ← {list.name}
        </Link>
        <h1 className="mt-1 break-words text-2xl font-semibold">Finalizar compra</h1>
        <ol aria-label="Pasos" className="mt-2 flex flex-wrap gap-x-3 gap-y-1 text-sm">
          {STEPS.map((label, i) => (
            <li
              key={label}
              aria-current={step === i + 1 ? 'step' : undefined}
              className={step === i + 1 ? 'font-semibold' : 'text-muted-foreground'}
            >
              {i + 1}. {label}
            </li>
          ))}
        </ol>
      </div>

      <h2 ref={headingRef} tabIndex={-1} className="text-lg font-medium outline-none">
        Paso {step} de 3: {STEPS[step - 1]}
      </h2>

      {step === 1 && (
        <div className="flex flex-col gap-3">
          <p className="text-sm text-muted-foreground">
            Confirmá la cantidad y el precio unitario ({currency}) de cada ítem tildado. El
            vencimiento es opcional.
          </p>
          {values.items.length === 0 && (
            <p role="alert" className="text-sm text-red-600">
              No hay ítems tildados. Volvé a la lista y tildá lo que compraste.
            </p>
          )}
          {fieldErrors.items && (
            <p role="alert" className="text-sm text-red-600">
              {fieldErrors.items}
            </p>
          )}
          <ul aria-label="Ítems tildados" className="flex flex-col gap-3">
            {values.items.map((item, i) => {
              const price = parseMoneyToMinor(item.unitPrice, currency)
              const line =
                price === null ? null : lineTotalMinor(normalizeDecimal(item.quantity), price)
              const k = (f: string) => `items.${i}.${f}`
              return (
                <li
                  key={item.listItemId}
                  className="flex flex-col gap-2 rounded-md border border-border p-3"
                >
                  <p className="break-words text-sm font-medium">
                    {item.name}{' '}
                    <span className="font-normal">({UNIT_SHORT_LABELS[item.unit]})</span>
                  </p>
                  <div className="grid grid-cols-1 gap-2 sm:grid-cols-3">
                    <Field name={k('quantity')} label="Cantidad" error={fieldErrors[k('quantity')]}>
                      {(aria) => (
                        <input
                          {...aria}
                          className={inputClass}
                          inputMode="decimal"
                          value={item.quantity}
                          onChange={(e) => setItem(i, { quantity: e.target.value }, k('quantity'))}
                        />
                      )}
                    </Field>
                    <Field
                      name={k('unitPrice')}
                      label="Precio unitario"
                      error={fieldErrors[k('unitPrice')]}
                    >
                      {(aria) => (
                        <input
                          {...aria}
                          className={inputClass}
                          inputMode="decimal"
                          placeholder="1.500,50"
                          value={item.unitPrice}
                          onChange={(e) =>
                            setItem(i, { unitPrice: e.target.value }, k('unitPrice'))
                          }
                        />
                      )}
                    </Field>
                    <Field
                      name={k('expiryDate')}
                      label="Vencimiento (opcional)"
                      error={fieldErrors[k('expiryDate')]}
                    >
                      {(aria) => (
                        <input
                          {...aria}
                          type="date"
                          className={inputClass}
                          value={item.expiryDate}
                          onChange={(e) =>
                            setItem(i, { expiryDate: e.target.value }, k('expiryDate'))
                          }
                        />
                      )}
                    </Field>
                  </div>
                  <p className="text-xs text-muted-foreground">
                    Subtotal: {line === null ? '—' : `${currency} ${formatMinor(line, currency)}`}
                  </p>
                </li>
              )
            })}
          </ul>
        </div>
      )}

      {step === 2 && (
        <div className="flex flex-col gap-3">
          <Field name="store" label="Comercio (opcional)" error={fieldErrors.store}>
            {(aria) => (
              <input
                {...aria}
                className={inputClass}
                maxLength={255}
                value={values.store}
                onChange={(e) => setField('store', e.target.value)}
              />
            )}
          </Field>
          <Field name="purchaseDate" label="Fecha" error={fieldErrors.purchaseDate}>
            {(aria) => (
              <input
                {...aria}
                type="date"
                className={inputClass}
                value={values.purchaseDate}
                onChange={(e) => setField('purchaseDate', e.target.value)}
              />
            )}
          </Field>
          <Field name="paidBy" label="Pagó" error={fieldErrors.paidBy}>
            {(aria) => (
              <select
                {...aria}
                className={inputClass}
                value={values.paidBy}
                onChange={(e) => setField('paidBy', e.target.value)}
              >
                <option value="">Elegí un miembro</option>
                {members
                  .filter((m) => m.active)
                  .map((m) => (
                    <option key={m.id} value={m.id}>
                      {m.displayName}
                    </option>
                  ))}
              </select>
            )}
          </Field>
          <Field name="total" label={`Total (${currency})`} error={fieldErrors.total}>
            {(aria) => (
              <input
                {...aria}
                className={inputClass}
                inputMode="decimal"
                placeholder="1.500,50"
                value={totalText}
                onChange={(e) => setField('totalOverride', e.target.value)}
              />
            )}
          </Field>
          <p className="text-sm text-muted-foreground">
            {sum === null
              ? 'La suma de los ítems no se puede calcular.'
              : `Suma de los ítems: ${currency} ${formatMinor(sum, currency)}.`}
            {values.totalOverride !== null && (
              <>
                {' '}
                <button
                  type="button"
                  className="underline"
                  onClick={() => setField('totalOverride', null)}
                >
                  Usar la suma
                </button>
              </>
            )}
          </p>
        </div>
      )}

      {step === 3 && (
        <div className="flex flex-col gap-3">
          {unchecked.length === 0 ? (
            <p className="text-sm">No hay ítems sin tildar: no queda nada pendiente.</p>
          ) : (
            <fieldset
              aria-describedby={
                fieldErrors.leftoverAction ? 'complete-leftoverAction-error' : undefined
              }
              className="flex flex-col gap-2"
            >
              <legend className="mb-1 text-sm font-medium">
                {unchecked.length === 1
                  ? 'Queda 1 ítem sin tildar. ¿Qué hacemos con él?'
                  : `Quedan ${unchecked.length} ítems sin tildar. ¿Qué hacemos con ellos?`}
              </legend>
              <ul className="mb-1 list-disc pl-5 text-sm text-muted-foreground">
                {unchecked.map((i) => (
                  <li key={i.id}>{i.product.name}</li>
                ))}
              </ul>
              {(
                [
                  ['NEW_LIST', 'Dejarlos en una lista nueva'],
                  ['DISCARD', 'Descartarlos'],
                ] as const
              ).map(([value, label]) => (
                <label key={value} className="flex min-h-10 items-center gap-2 text-sm">
                  <input
                    type="radio"
                    name="leftoverAction"
                    id={value === 'NEW_LIST' ? fieldId('leftoverAction') : undefined}
                    checked={values.leftoverAction === value}
                    onChange={() => setField('leftoverAction', value)}
                    className="size-5"
                  />
                  {label}
                </label>
              ))}
              {fieldErrors.leftoverAction && (
                <p id="complete-leftoverAction-error" role="alert" className="text-sm text-red-600">
                  {fieldErrors.leftoverAction}
                </p>
              )}
            </fieldset>
          )}
          <dl className="rounded-md border border-border p-3 text-sm">
            <div className="flex justify-between gap-2">
              <dt>Ítems</dt>
              <dd>{values.items.length}</dd>
            </div>
            <div className="flex justify-between gap-2">
              <dt>Total</dt>
              <dd className="font-medium">
                {totalMinor === null ? '—' : `${currency} ${formatMinor(totalMinor, currency)}`}
              </dd>
            </div>
          </dl>
        </div>
      )}

      {problem?.message && (
        <div ref={alertRef} tabIndex={-1} role="alert" className="text-sm text-red-600">
          {problem.message}
        </div>
      )}

      <div className="flex flex-wrap gap-2">
        {step > 1 && (
          <Button
            type="button"
            variant="outline"
            disabled={busy}
            onClick={() => setStep((s) => (s > 1 ? ((s - 1) as StepNumber) : s))}
          >
            Atrás
          </Button>
        )}
        <Button type="submit" disabled={busy || values.items.length === 0}>
          {step < 3 ? 'Siguiente' : busy ? 'Registrando…' : 'Confirmar compra'}
        </Button>
        <Button asChild variant="outline">
          <Link to={`/listas/${list.id}`}>Cancelar</Link>
        </Button>
      </div>
    </form>
  )
}

function omit(obj: FieldErrors, key: string): FieldErrors {
  const copy = { ...obj }
  delete copy[key]
  return copy
}
