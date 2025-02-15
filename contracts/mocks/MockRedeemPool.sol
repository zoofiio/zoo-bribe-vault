// SPDX-License-Identifier: Apache-2.0
pragma solidity ^0.8.18;

import "@openzeppelin/contracts/utils/math/Math.sol";

import "../vaults/RedeemPool.sol";

contract MockRedeemPool is RedeemPool {
  using Math for uint256;

  constructor(address _vault_) RedeemPool(_vault_) {

  }

  function getRedeemingSharesByBalance(uint256 stakingBalance) public override view onlyBeforeSettlement returns (uint256) {
    if (totalRedeemingBalance() == 0 || _totalRedeemingShares == 0) return stakingBalance;

    return stakingBalance.mulDiv(_totalRedeemingShares, totalRedeemingBalance());
  }

  function getRedeemingBalanceByShares(uint256 stakingShares) public override view onlyBeforeSettlement returns (uint256) {
    if (_totalRedeemingShares == 0) return 0;
  
    return stakingShares.mulDiv(totalRedeemingBalance(), _totalRedeemingShares);
  }

}