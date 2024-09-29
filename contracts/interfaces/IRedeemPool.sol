// SPDX-License-Identifier: Apache-2.0
pragma solidity ^0.8.18;

interface IRedeemPool {

  function totalRedeemingBalance() external returns (uint256);

  function claimAssetTokenFor(address account) external;

  function notifySettlement(uint256 assetAmount) external;

  function pause() external;

  function unpause() external;

}