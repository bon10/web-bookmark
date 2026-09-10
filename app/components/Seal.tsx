/**
 * 本アプリのシンボル。朱の角印に「栞」を彫った意匠で、ログイン画面とヘッダーで共用する。
 * 装飾のみで意味を持たないため、支援技術には読ませない。
 */
export default function Seal({size = 40}: {size?: number}) {
  return (
    <span aria-hidden="true" className="seal" style={{width: size, height: size, fontSize: size * 0.52}}>
      <span className="font-display font-semibold leading-none">栞</span>
    </span>
  );
}
