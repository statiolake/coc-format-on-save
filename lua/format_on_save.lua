local M = {}

---@type "auto" | "always" | "never"
local format_on_save_mode = 'auto'

local function on_buf_write()
  local mode = format_on_save_mode
  local format_command = nil
  if mode == 'always' then
    format_command = 'format-on-save.format'
  elseif mode == 'auto' then
    format_command = 'format-on-save.formatOnDemand'
  end

  if format_command then
    if vim.g.coc_service_initialized == 0 then
      vim.notify 'Skip formatting: coc.nvim is not ready yet'
      return
    end

    local ok, reason = pcall(vim.fn.CocAction, 'runCommand', format_command)
    if not ok then
      vim.notify(string.format('Formatting failed: %s', reason))
    end
  end
end

---Save with the command
---@param mode "auto" | "always" | "never"
---@param vim_save_command string
---@param file_name string
function M.save(mode, vim_save_command, file_name)
  local previous_mode = format_on_save_mode
  format_on_save_mode = mode
  local ok, err = pcall(vim.cmd, {
    cmd = vim_save_command,
    args = file_name and file_name ~= '' and { file_name } or {},
  })
  format_on_save_mode = previous_mode
  if not ok then
    error(err)
  end
end

function M.setup()
  local group =
    vim.api.nvim_create_augroup('CocFormatOnSave', { clear = true })
  vim.api.nvim_create_autocmd('BufWritePre', {
    group = group,
    pattern = '*',
    callback = on_buf_write,
  })
end

return M
