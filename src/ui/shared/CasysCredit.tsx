/** Shared viewer credit using the existing Casys brand asset. */
const casysLogo = new URL("./casys-logo.svg", import.meta.url).href;

export function CasysCredit() {
  return (
    <a
      className="syson-casys-credit"
      href="https://casys.ai"
      target="_blank"
      rel="noopener noreferrer"
    >
      <img src={casysLogo} alt="" width={13} height={13} />
      <span>Powered by Casys.ai</span>
    </a>
  );
}
