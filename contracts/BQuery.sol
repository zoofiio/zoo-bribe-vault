// SPDX-License-Identifier: Apache-2.0
pragma solidity ^0.8.18;
import "./interfaces/IPToken.sol";
import "./interfaces/IVault.sol";
import "./libs/Constants.sol";
import "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import "@openzeppelin/contracts/access/Ownable.sol";

interface MIVault is IVault {
    function epochIdCount() external view returns (uint256);

    function closed() external view returns (bool);

    function paused() external view returns (bool);

    function Y() external view returns (uint256);

    function calcBribes(
        uint256 epochId,
        address account
    ) external view returns (Constants.BribeInfo[] memory);

    function bribeTotalAmount(
        uint256 epochId,
        address bribeToken
    ) external view returns (uint256);

    function assetTotalSwapAmount(
        uint256 epochId
    ) external view returns (uint256);
}

interface ERC20 is IERC20 {
    function symbol() external view returns (string memory);
}

interface ILP is IERC20 {
    function poolType() external view returns (uint256);

    function baseToken() external view returns (address);

    function quoteToken() external view returns (address);
}

interface CrocQuery {
    function queryPrice(
        address base,
        address quote,
        uint256 poolType
    ) external view returns (uint128);
}

interface IRedeemPool {
    function settled() external view returns (bool);

    function userRedeemingBalance(
        address account
    ) external view returns (uint256);

    function earnedAssetAmount(address account) external view returns (uint256);

    function totalRedeemingBalance() external view returns (uint256);
}

contract BQuery is Ownable {
    mapping(address => bool) internal isLP;
    address public crocquery;
    struct BVaultEpoch {
        uint256 epochId;
        uint256 startTime;
        uint256 duration;
        address redeemPool;
        uint256 yTokenTotal;
        uint256 vaultYTokenBalance;
        uint256 assetTotalSwapAmount;
        uint256 yTokenAmountForSwapYT;
        uint256 totalRedeemingBalance;
        bool settled;
    }
    struct BVault {
        uint256 epochCount;
        uint256 pTokenTotal;
        uint256 lockedAssetTotal;
        uint256 f2;
        bool closed;
        uint256 lpLiq;
        uint256 lpBase;
        uint256 lpQuote;
        uint256 Y;
        BVaultEpoch current;
    }
    struct BribeInfo {
        uint256 epochId;
        address bribeToken;
        uint256 bribeAmount;
        string bribeSymbol;
        uint256 bribeTotalAmount;
    }
    struct BVaultEpochUser {
        uint256 epochId;
        BribeInfo[] bribes;
        uint256 redeemingBalance;
        uint256 claimableAssetBalance;
        uint256 userBalanceYToken;
        uint256 userBalanceYTokenSyntyetic;
    }

    function queryBVault(address vault) external view returns (BVault memory) {
        return _queryBVault(vault);
    }

    function queryBVaultEpoch(
        address vault,
        uint256 epochId
    ) external view returns (BVaultEpoch memory) {
        return _queryBVaultEpoch(vault, epochId);
    }

    function liqToTokens(
        uint128 liq,
        uint128 price
    ) external pure returns (uint192 base, uint192 quote) {
        return _liqToTokens(liq, price);
    }

    // ====================internal====================

    function _vaultClosed(address vault) internal view returns (bool closed) {
        try MIVault(vault).closed() returns (bool _closed) {
            closed = _closed;
        } catch {}
    }

    function _queryBVault(
        address vault
    ) internal view returns (BVault memory bv) {
        MIVault ibv = MIVault(vault);
        address pToken = ibv.pToken();
        bv.epochCount = ibv.epochIdCount();
        bv.pTokenTotal = IPToken(pToken).totalSupply();

        bv.f2 = ibv.paramValue("f2");
        (bool successY, bytes memory data) = vault.staticcall(
            abi.encodeWithSignature("Y()")
        );
        if (successY) {
            bv.Y = abi.decode(data, (uint256));
        }
        bv.closed = _vaultClosed(vault);
        if (!bv.closed) {
            bv.lockedAssetTotal = ibv.assetBalance();
        }
        if (bv.epochCount > 0) {
            bv.current = _queryBVaultEpoch(vault, bv.epochCount);
        }
        address assetToken = ibv.assetToken();
        if (isLP[assetToken]) {
            ILP lp = ILP(assetToken);
            bv.lpLiq = bv.lockedAssetTotal;
            if (bv.lpLiq > 0) {
                unchecked {
                    (bv.lpBase, bv.lpQuote) = _liqToTokens(
                        uint128(bv.lpLiq),
                        CrocQuery(crocquery).queryPrice(
                            lp.baseToken(),
                            lp.quoteToken(),
                            lp.poolType()
                        )
                    );
                }
            }
        }
    }

    function _queryBVaultEpoch(
        address vault,
        uint256 epochId
    ) internal view returns (BVaultEpoch memory bve) {
        MIVault ibv = MIVault(vault);
        Constants.Epoch memory epoch = ibv.epochInfoById(epochId);
        bve.epochId = epoch.epochId;
        bve.startTime = epoch.startTime;
        bve.duration = epoch.duration;
        bve.redeemPool = epoch.redeemPool;
        bve.yTokenTotal = ibv.yTokenTotalSupply(epochId);
        bve.vaultYTokenBalance = ibv.yTokenUserBalance(epochId, vault);
        bve.assetTotalSwapAmount = ibv.assetTotalSwapAmount(epochId);
        bve.settled = IRedeemPool(epoch.redeemPool).settled();
        if (!bve.settled) {
            bve.totalRedeemingBalance = IRedeemPool(epoch.redeemPool)
                .totalRedeemingBalance();
        }
        if (bve.yTokenTotal > bve.vaultYTokenBalance) {
            bve.yTokenAmountForSwapYT =
                bve.yTokenTotal -
                bve.vaultYTokenBalance;
        }
    }

    function _liqToTokens(
        uint128 liq,
        uint128 price
    ) internal pure returns (uint192 base, uint192 quote) {
        unchecked {
            // 128 bit integers squared will always fit in 256-bits
            base = uint192((uint256(liq) * uint256(price)) >> 64);
            quote = (uint192(liq) << 64) / price;
        }
    }

    // ============== set =================
    function setLP(address asset, bool islp) external onlyOwner {
        if (islp) {
            isLP[asset] = true;
        } else {
            delete isLP[asset];
        }
    }

    function setCrocQuery(address cq) external onlyOwner {
        crocquery = cq;
    }
}
