

```mermaid
classDiagram
note for ZooProtocol "Entry point of protocol"
class ZooProtocol {
  +address owner
  +ProtocolSettings settings
  +Vault[] vaults
  +addVault(vault)
}
class ProtocolSettings {
  +address treasury
  +Params[] params
  +Params[] vaultParams
  +setTreasury(treasury)
  +upsertParamConfig(default, min, max)
  +updateVaultParamValue(vault, param, value)
}
note for StakingPool "InfraRed"
class StakingPool {
  +address[] public rewardTokens
  +stake(amount)
  +withdraw(amount)
  +getRewards()
}
namespace B-Vault {
  class Vault {
    +address asset
    +address pToken
    +address redeemPool
    +deposit(amount)
    +swap(amount)
    +claimBribes()
  }
  class PToken {
    +mint(amount)
    +burn(amount)
    +rebase(amount)
    +...()
  }
  class RedeemPool {
    bool internal _settled;
    +redeem(amount)
    +withdrawRedeem(amount)
    +claimAssetToken()
    +exit()
    +...()
  }
}


ZooProtocol --> ProtocolSettings
ZooProtocol "1" --> "*" Vault
Vault --> PToken
Vault --> RedeemPool
Vault --> StakingPool

``````