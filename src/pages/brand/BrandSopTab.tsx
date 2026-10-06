import SopDocPane from '../sops/SopDocPane';

/** Brand Detail → SOP tab (?tab=sop). The document pane does all the work. */
export default function BrandSopTab({ brandId, brandName, canEdit }: {
  brandId: string;
  brandName: string;
  canEdit: boolean;
}) {
  return <SopDocPane brandId={brandId} brandName={brandName} canEdit={canEdit} />;
}
