import type { CertificateVersionEntity } from '../../certificates/schema/certificates.schema.js';

export function isDeployableCertificateVersion(version: CertificateVersionEntity, now = Date.now()): boolean {
  const notAfter = new Date(version.notAfter).getTime();
  return version.status === 'active'
    && version.deployable === true
    && Number.isFinite(notAfter)
    && notAfter > now;
}

export function selectLatestDeployableCertificateVersion(
  versions: readonly CertificateVersionEntity[],
  certificateAssetId: string,
  now = Date.now(),
): CertificateVersionEntity | undefined {
  return versions
    .filter((version) => version.certificateAssetId === certificateAssetId)
    .filter((version) => isDeployableCertificateVersion(version, now))
    .sort((left, right) => {
      const notAfter = compareTimeDesc(left.notAfter, right.notAfter);
      if (notAfter !== 0) return notAfter;
      const versionNo = right.versionNo - left.versionNo;
      if (versionNo !== 0) return versionNo;
      return compareTimeDesc(left.createdAt, right.createdAt);
    })[0];
}

function compareTimeDesc(left: unknown, right: unknown): number {
  const leftTime = new Date(String(left ?? '')).getTime();
  const rightTime = new Date(String(right ?? '')).getTime();
  return (Number.isFinite(rightTime) ? rightTime : 0) - (Number.isFinite(leftTime) ? leftTime : 0);
}
