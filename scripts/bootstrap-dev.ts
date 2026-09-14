import { createContainer } from "../backend/src/container";

if (process.env.BEL_ENV === "production" || process.env.BEL_DEV_BOOTSTRAP !== "true") {
  throw new Error("Development bootstrap requires BEL_ENV=development and BEL_DEV_BOOTSTRAP=true");
}

const container = createContainer();
const credential = process.env.BEL_BOOTSTRAP_CREDENTIAL ?? "dev-admin-001";
const existing = await container.users.getById("ADMIN-001");
if (existing) {
  console.log("ADMIN-001 already exists");
} else {
  await container.users.createUser({ employeeId: "ADMIN-001", fullName: "BEL Development Administrator", role: "ADMIN", department: "PLATFORM" });
  await container.users.registerDevice("ADMIN-001", "BEL-DEV-ADMIN-001", credential);
  const wallet = await container.users.activateWallet("ADMIN-001", "BEL-DEV-ADMIN-001");
  console.log(JSON.stringify({ employeeId: "ADMIN-001", deviceId: "BEL-DEV-ADMIN-001", credential, walletAddress: wallet.address }));
}
