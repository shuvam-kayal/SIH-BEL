import { randomUUID } from "node:crypto";
import type { Identity, ValidatorRegistration } from "../../../shared/types";
import type { IdentityRepositories } from "../users/repositories";
import { ConsoleEmailNotificationProvider, type EmailNotificationProvider } from "./email.provider";

export class NotificationService {
  constructor(private readonly repositories: IdentityRepositories, private readonly email: EmailNotificationProvider = new ConsoleEmailNotificationProvider()) {}

  async validatorChanged(eventType: "VALIDATOR_ADD" | "VALIDATOR_REMOVE" | "VALIDATOR_RESTORE", validator: ValidatorRegistration, actor: Identity): Promise<void> {
    const active = await this.repositories.identities.listByStatus("ACTIVE");
    const users = await Promise.all(active.map((identity) => this.repositories.users.findByIdentityId(identity.identityId)));
    const subject = eventType === "VALIDATOR_ADD" ? "BEL Validator Added" : eventType === "VALIDATOR_REMOVE" ? "BEL Validator Removed" : "BEL Validator Restored";
    const body = `A validator was ${eventType === "VALIDATOR_ADD" ? "added" : eventType === "VALIDATOR_REMOVE" ? "removed" : "restored"} to the BEL network. Validator: ${validator.validatorId}. Performed by: ${actor.identityId}. Transaction: ${validator.txHash ?? "pending"}. Block: ${validator.blockNumber ?? "unknown"}.`;
    for (const recipientIdentityId of [...new Set(users.filter(Boolean).map((user) => user!.identityId))]) {
      await this.repositories.notifications.append({ notificationId: `N:${randomUUID()}`, eventType, validatorId: validator.validatorId, operation: eventType, recipientIdentityId, channel: "IN_APP", createdAt: new Date().toISOString(), status: "DELIVERED" });
      try {
        await this.email.send({ toIdentityId: recipientIdentityId, subject, body });
        await this.repositories.notifications.append({ notificationId: `N:${randomUUID()}`, eventType, validatorId: validator.validatorId, operation: eventType, recipientIdentityId, channel: "EMAIL", createdAt: new Date().toISOString(), status: "DELIVERED" });
      } catch {
        await this.repositories.notifications.append({ notificationId: `N:${randomUUID()}`, eventType, validatorId: validator.validatorId, operation: eventType, recipientIdentityId, channel: "EMAIL", createdAt: new Date().toISOString(), status: "FAILED" });
      }
    }
  }
}
