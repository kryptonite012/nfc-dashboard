import { Eye, EyeOff } from 'lucide-react';
import { forwardRef, useEffect, useState, type InputHTMLAttributes } from 'react';
import { Input } from '@/components/ui/input';
import { cn } from '@/lib/utils';

export const PasswordInput = forwardRef<HTMLInputElement, InputHTMLAttributes<HTMLInputElement>>(({ className, ...props }, ref) => {
  const [visible, setVisible] = useState(false);
  return (
    <div className="relative">
      <Input ref={ref} type={visible ? 'text' : 'password'} className={cn('pr-11', className)} spellCheck={false} autoCapitalize="off" {...props} />
      <button
        type="button"
        onClick={() => setVisible((value) => !value)}
        className="absolute inset-y-0 right-0 flex w-11 items-center justify-center rounded-r-md text-muted-foreground hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-ring"
        aria-label={visible ? 'Hide password' : 'Show password'}
        aria-pressed={visible}
      >
        {visible ? <EyeOff className="size-4" /> : <Eye className="size-4" />}
      </button>
    </div>
  );
});
PasswordInput.displayName = 'PasswordInput';

type Checker = (password: string, inputs: string[]) => { score: number; feedback: { warning: string | null; suggestions: string[] } };

let checkerPromise: Promise<Checker> | null = null;

/** The strength estimator and its dictionaries are large, so they load only on pages that need them. */
function loadChecker(): Promise<Checker> {
  checkerPromise ??= Promise.all([
    import('@zxcvbn-ts/core'),
    import('@zxcvbn-ts/language-common'),
    import('@zxcvbn-ts/language-en'),
  ]).then(([core, common, en]) => {
    const factory = new core.ZxcvbnFactory({
      dictionary: { ...common.dictionary, ...en.dictionary },
      graphs: common.adjacencyGraphs,
      translations: en.translations,
    });
    return (password, inputs) => factory.check(password, inputs);
  });
  return checkerPromise;
}

const LABELS = ['Very weak', 'Weak', 'Fair', 'Strong', 'Very strong'];
const COLORS = ['bg-destructive', 'bg-destructive', 'bg-warning', 'bg-success', 'bg-success'];

/** Guidance only: the server performs the authoritative strength and breach checks. */
export function PasswordStrength({ password, userInputs = [], minLength }: { password: string; userInputs?: string[]; minLength: number }) {
  const [result, setResult] = useState<{ score: number; hint: string | null } | null>(null);
  const inputsKey = userInputs.join('|');

  useEffect(() => {
    if (!password) {
      setResult(null);
      return;
    }
    let cancelled = false;
    const timer = setTimeout(() => {
      void loadChecker().then((check) => {
        if (cancelled) return;
        const outcome = check(password, inputsKey.split('|').filter((value) => value.length >= 3));
        setResult({ score: outcome.score, hint: outcome.feedback.warning || outcome.feedback.suggestions[0] || null });
      });
    }, 150);
    return () => {
      cancelled = true;
      clearTimeout(timer);
    };
  }, [password, inputsKey]);

  if (!password) {
    return <p className="text-xs text-muted-foreground">Use at least {minLength} characters. A few unrelated words make a strong, memorable password.</p>;
  }
  const score = password.length < minLength ? Math.min(result?.score ?? 0, 1) : (result?.score ?? 0);
  return (
    <div className="space-y-1.5" aria-live="polite">
      <div className="flex gap-1" aria-hidden>
        {[0, 1, 2, 3].map((index) => (
          <span key={index} className={cn('h-1.5 flex-1 rounded-full', index < Math.max(score, 1) ? COLORS[score] : 'bg-muted')} />
        ))}
      </div>
      <p className="text-xs text-muted-foreground">
        <span className="font-medium text-foreground">Strength: {LABELS[score]}.</span>{' '}
        {password.length < minLength ? `Use at least ${minLength} characters.` : score < 3 ? (result?.hint ?? 'Add more unrelated words.') : 'Looks good.'}
      </p>
    </div>
  );
}
