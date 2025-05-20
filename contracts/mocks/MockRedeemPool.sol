// SPDX-License-Identifier: Apache-2.0
pragma solidity ^0.8.20;

import "@openzeppelin/contracts/utils/math/Math.sol";

import "../vaults/RedeemPool.sol";

contract MockRedeemPool is RedeemPool {
  using Math for uint256;

  constructor(address _vault_) RedeemPool(_vault_) {

  }

  function _convertToShares(uint256 assets, Math.Rounding rounding) internal view override returns (uint256) {
    if (totalRedeemingBalance() == 0 || _totalRedeemingShares == 0) return assets;

    return assets.mulDiv(
      _totalRedeemingShares, 
      totalRedeemingBalance(), 
      rounding
    );
  }

  function _convertToAssets(uint256 shares, Math.Rounding rounding) internal view override returns (uint256) {
    if (_totalRedeemingShares == 0) return 0;

    return shares.mulDiv(
      totalRedeemingBalance(),
      _totalRedeemingShares,
      rounding
    );
  }

}