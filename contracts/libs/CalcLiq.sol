// SPDX-License-Identifier: Apache-2.0
pragma solidity ^0.8.18;

contract CalcLiq {
    function liqToTokens(
        uint128 liq,
        uint128 price
    ) external pure returns (uint192 base, uint192 quote) {
        unchecked {
            // 128 bit integers squared will always fit in 256-bits
            base = uint192((uint256(liq) * uint256(price)) >> 64);
            quote = (uint192(liq) << 64) / price;
        }
    }
}
