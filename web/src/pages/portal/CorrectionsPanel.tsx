import { CorrectionRulesCard } from '../../components/CorrectionRulesCard';

export function CorrectionsPanel() {
  return <CorrectionRulesCard basePath="/portal/corrections" queryKey={['portal', 'corrections']} />;
}
