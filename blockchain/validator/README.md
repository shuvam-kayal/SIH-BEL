# validator/

Owner: Person 4.

Validator identity, key management, and the authorized-validator-set
registry. The set is permissioned: no open join (SYSTEM_SPEC.md).

Note the split from `contracts/src/IIdentityRegistry.sol` — validators
are network participants, employees are platform users. They are
different registries even if a person maps to both.
