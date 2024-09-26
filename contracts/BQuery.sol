// SPDX-License-Identifier: Apache-2.0
pragma solidity ^0.8.18;
import "./interfaces/IPToken.sol";
import "./interfaces/IVault.sol";
import "./libs/Constants.sol";

interface MIVault is IVault {
  function epochIdCount() external view returns (uint256);
  function closed() external view returns (bool);
}

contract BQuery {
    /*
    Y: bigint
          yTokenTotalSupply: bigint
          pTokenSynthetic: bigint
          assetAmountForSwapYT: bigint
          yTokenAmountForSwapYT: bigint
    */
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
        uint256 yTokenTotalSupply;
        uint256 pTokenSynthetic;
        uint256 assetAmountForSwapYT;

    }

    function queryBVault(address vault) external view returns (BVault memory bv) {
       MIVault ibv = MIVault(vault);
       bv.epochCount = ibv.epochIdCount();
       bv.pTokenTotal = IPToken(ibv.pToken()).totalSupply();
    }
}
