import { SetupWizard } from './setup-wizard';

export const metadata = { title: 'Setup' };

export default function SetupPage(): JSX.Element {
  return (
    <div className="min-h-screen bg-background">
      <SetupWizard />
    </div>
  );
}
