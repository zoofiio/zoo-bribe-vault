// SPDX-License-Identifier: Apache-2.0
pragma solidity ^0.8.18;

import "@openzeppelin/contracts/token/ERC20/IERC20.sol";

interface IUsd is IERC20 {

  function decimals() external view returns (uint8);

  function getBalanceByShares(uint256 sharesAmount) external view returns (uint256);

  function getSharesByBalance(uint256 balance) external view returns (uint256);

  function mint(address to, uint256 amount) external returns (uint256);

  function burn(address account, uint256 amount) external returns (uint256);

  function transferShares(address to, uint256 sharesAmount) external returns (uint256);

  function rebase(uint256 addedSupply) external;
}