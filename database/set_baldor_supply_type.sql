-- set_baldor_supply_type.sql - records "fixed-frequency line supply" on the Baldor motors. Run in the Supabase SQL Editor.
-- Reversible: undo with   update public.motors set supply_type = null where motor_tag in (<the same tags>);
-- Only touches motors.supply_type, and only where it is currently NULL. No other column, table or row changes.
--
-- You are STATING that these motors are supplied directly from the line (not from an inverter / variable-frequency drive).
-- The NEMA MG 1 12.44.1 profile applies only to such motors. Check each against its nameplate or datasheet when you can.
--
-- Deliberately NOT included:
--   MTR-001      415 V / 50 Hz motor: the 460 V / 60 Hz NEMA profile does not apply to it anyway.
--   MTR-BAL-009  VECP3770T-4  } model names that suggest vector / inverter duty. Leave them blank until you have checked the
--   MTR-BAL-012  VEBM3558     } datasheet. If you CONFIRM they are line-fed, run the second statement below.

update public.motors
   set supply_type = 'line'
 where motor_tag in (
         'MTR-BAL-001', 'MTR-BAL-002', 'MTR-BAL-003', 'MTR-BAL-004', 'MTR-BAL-005', 'MTR-BAL-006', 'MTR-BAL-007',
         'MTR-BAL-008', 'MTR-BAL-010', 'MTR-BAL-011', 'MTR-BAL-013', 'MTR-BAL-014', 'MTR-BAL-015')
   and supply_type is null
returning motor_tag, model, supply_type;

-- OPTIONAL - only after you have confirmed from the datasheet that these two are NOT inverter-fed. Remove the two leading dashes of each line to use it.
-- update public.motors set supply_type = 'line' where motor_tag in ('MTR-BAL-009', 'MTR-BAL-012') and supply_type is null returning motor_tag, model, supply_type;
