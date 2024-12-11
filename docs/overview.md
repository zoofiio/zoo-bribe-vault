

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
    +address epochRedeemPools
    +address epochStakingBribesPools
    +address epochAdhocBribesPools
    +deposit(amount)
    +swap(amount)
    +setBriber(briber)
    +addAdhocBribes(token, amount)
    +pause()
    +close()
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
  class StakingBribesPool {
    +balanceOf(address)
    +totalSupply()
    +earned(user, bribeToken)
    +getBribes()
    +notifyYTSwappedForUser(user, amount)
    +addBribes(bribeToken, amount)
    +...()
  }
  class AdhocBribesPool {
    +balanceOf(address)
    +totalSupply()
    +earned(user, bribeToken)
    +collectableYT()
    +collectYT()
    +getBribes()
    +notifyYTSwappedForUser(user, amount)
    +addBribes(bribeToken, amount)
    +...()
  }
}


ZooProtocol --> ProtocolSettings
ZooProtocol "1" --> "*" Vault
Vault --> PToken
Vault --> StakingPool
Vault --> RedeemPool : Each Epoch
Vault --> StakingBribesPool : Each Epoch
Vault --> AdhocBribesPool : Each Epoch
``````