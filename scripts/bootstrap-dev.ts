import { createContainer } from "../backend/src/container";

async function main() {
  if (process.env.BEL_ENV !== "development" || process.env.BEL_DEV_BOOTSTRAP !== "true") {
    throw new Error("Development bootstrap requires BEL_ENV=development and BEL_DEV_BOOTSTRAP=true");
  }
  if (!process.env.DATABASE_URL) throw new Error("Development bootstrap requires DATABASE_URL and PostgreSQL");

  const container = createContainer();
  const credential = process.env.BEL_BOOTSTRAP_CREDENTIAL ?? "dev-admin-001";
  const walletAddress = process.env.BEL_BOOTSTRAP_WALLET_ADDRESS;
  const publicKey = process.env.BEL_BOOTSTRAP_PUBLIC_KEY;
  if (!walletAddress || !publicKey) throw new Error("Development bootstrap requires BEL_BOOTSTRAP_WALLET_ADDRESS and BEL_BOOTSTRAP_PUBLIC_KEY");
  const evm = (process.env.BEL_BLOCKCHAIN ?? "mock").trim().toLowerCase() === "evm";
  try {
    await container.prisma?.$connect();
    // EVM deployment already creates the bootstrap admin identity/wallet.
    // Verify that anchor before either reusing or mirroring the PostgreSQL row.
    const onChain = evm ? await container.chain.getWallet(walletAddress) : null;
    if (evm && (!onChain || onChain.status !== "ACTIVE")) throw new Error("EVM bootstrap wallet must already be ACTIVE on-chain");
    const existing = await container.users.getById("ADMIN-001");
    if (existing) {
      console.log("ADMIN-001 already bootstrapped");
    } else {
      // Mirror that identity in PostgreSQL instead of attempting duplicate
      // IDENTITY_CREATE/ROLE_ASSIGN transactions from a wallet-less user.
      await container.users.createUser({ employeeId: "ADMIN-001", identityId: onChain?.identityId ?? process.env.BEL_BOOTSTRAP_ADMIN_DID ?? "DID:BEL:ADMIN", fullName: "BEL Development Administrator", role: "ADMIN", department: "PLATFORM" });
      await container.users.registerDevice("ADMIN-001", "BEL-DEV-ADMIN-001", credential, publicKey);
      await container.users.registerWallet("ADMIN-001", "BEL-DEV-ADMIN-001", walletAddress);
      const wallet = await container.users.activateWallet("ADMIN-001", "BEL-DEV-ADMIN-001", walletAddress);
      console.log(JSON.stringify({ employeeId: "ADMIN-001", deviceId: "BEL-DEV-ADMIN-001", credential, walletAddress: wallet.address }));
    }
  } finally {
    await container.prisma?.$disconnect();
  }
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
