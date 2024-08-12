

```mermaid
classDiagram
note for ZooProtocol "Entry point of protocol"
class ZooProtocol {
  +address owner
  +$Usd Usd
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
class Usd {
  +map userShares
  +uint256 totalShares
  +sharesOf(user)
  +transferShares(to, amount)
  +rebase(amount)
  +...()
}
class VaultQuery {
  +AAR(vault)
  +getVaultState(vault)
  +calcMintPairs(vault, assetAmount)
  +..()
}
namespace VolatileVault {
  class Vault {
    +address asset
    +address priceFeed
    +address ethx
    +address ptyPoolBuyLow
    +address ptyPoolSellHigh
    +mint(amount)
    +redeem(amount)
    +usdToMarginTokens(amount)
  }
  class EthPriceFeed {
    +latestPrice()
  }
  class ETHx {
    +mint(amount)
    +burn(amount)
    +...()
  }
  class PtyPool {
    +stake(amount)
    +claim(amount)
    +exit()
    +addRewards(amount)
    +...()
  }
}

class StableVault {
  +address asset
  +address priceFeed
  +address usdbx
  +mint(amount)
  +redeem(amount)
  +usdToMarginTokens(amount)
}

ZooProtocol --> ProtocolSettings
ZooProtocol --> Usd
ZooProtocol "1" --> "*" Vault
Vault --> EthPriceFeed
Vault --> ETHx
Vault "1" --> "2" PtyPool

class USDCPriceFeed {
  +latestPrice()
}
class USDCx {
  +mint(amount)
  +burn(amount)
  +...()
}
ZooProtocol "1" --> "*" StableVault
StableVault --> USDCPriceFeed
StableVault --> USDCx

VaultQuery --> Vault
VaultQuery --> StableVault
``````